#!/usr/bin/env python3
"""
Деплой Sphere3D на VPS без пароля (deploy/keys/spherio_deploy).
Запуск: python scripts/deploy.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
KEY = ROOT / "deploy" / "keys" / "spherio_deploy"
ENV_FILE = ROOT / "deploy" / "secrets" / ".env.production"
HOST = os.environ["SPHERIO_HOST"]  # IP/hostname VPS, обязателен
USER = os.environ.get("SPHERIO_SSH_USER", "root")
REMOTE_DIR = "/opt/spherio"


def _nginx_ssl_snippets_cmd() -> str:
    return (
        "mkdir -p /etc/letsencrypt /var/www/certbot && "
        "test -f /etc/letsencrypt/options-ssl-nginx.conf || "
        "curl -fsSL https://raw.githubusercontent.com/certbot/certbot/v2.11.0/"
        "certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf "
        "-o /etc/letsencrypt/options-ssl-nginx.conf; "
        "test -f /etc/letsencrypt/ssl-dhparams.pem || "
        "curl -fsSL https://raw.githubusercontent.com/certbot/certbot/v2.11.0/"
        "certbot/certbot/ssl-dhparams.pem -o /etc/letsencrypt/ssl-dhparams.pem"
    )

EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "client/dist",
    "server/dist",
    "shared/dist",
    ".cursor",
}
EXCLUDE_FILES = {".env"}


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c.connect(HOST, username=USER, pkey=pkey, timeout=60, look_for_keys=False, allow_agent=False)
    return c


def run(
    client: paramiko.SSHClient,
    cmd: str,
    check: bool = True,
    *,
    pty: bool = False,
) -> tuple[int, str, str]:
    print(f"\n$ {cmd}")
    _, stdout, stderr = client.exec_command(cmd, get_pty=pty)
    stdout.channel.settimeout(None)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    if check and code != 0:
        raise SystemExit(f"Команда завершилась с кодом {code}")
    return code, out, err


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except OSError:
                pass

    if not KEY.exists():
        subprocess.check_call([sys.executable, str(ROOT / "scripts" / "gen-deploy-key.py")])
    subprocess.check_call([sys.executable, str(ROOT / "scripts" / "generate-prod-env.py")])
    if not ENV_FILE.exists():
        raise SystemExit(f"Нет {ENV_FILE}")

    client = connect()
    sftp = client.open_sftp()

    print("==> Упаковка проекта")
    tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        with tarfile.open(tmp_path, "w:gz") as tar:
            for path in ROOT.rglob("*"):
                if not path.is_file():
                    continue
                rel = path.relative_to(ROOT)
                if rel.parts and rel.parts[0] in EXCLUDE_DIRS:
                    continue
                if any(p in EXCLUDE_DIRS for p in rel.parts):
                    continue
                if rel.name in EXCLUDE_FILES:
                    continue
                posix = rel.as_posix()
                if posix.startswith("deploy/keys/"):
                    continue
                if posix.startswith("deploy/secrets/") and posix.endswith(".production"):
                    continue
                tar.add(path, arcname=posix)
        run(client, f"mkdir -p {REMOTE_DIR}")
        sftp.put(str(tmp_path), f"{REMOTE_DIR}/release.tar.gz")
    finally:
        tmp_path.unlink(missing_ok=True)

    sftp.put(str(ENV_FILE), f"{REMOTE_DIR}/.env")
    sftp.close()

    run(client, f"cd {REMOTE_DIR} && tar -xzf release.tar.gz && rm -f release.tar.gz")

    setup_flag = f"{REMOTE_DIR}/.setup_done"
    _, out, _ = run(client, f"test -f {setup_flag} && echo yes || echo no", check=False)
    if "yes" not in out:
        print("==> Первичная настройка сервера")
        setup_sh = (ROOT / "deploy" / "setup-server.sh").read_text(encoding="utf-8")
        sftp2 = client.open_sftp()
        with sftp2.file("/tmp/spherio-setup.sh", "w") as f:
            f.write(setup_sh)
        sftp2.close()
        run(client, "chmod +x /tmp/spherio-setup.sh && /tmp/spherio-setup.sh")
        run(client, f"touch {setup_flag}")

    compose = (
        f"docker compose --project-directory {REMOTE_DIR} "
        f"-f {REMOTE_DIR}/deploy/docker-compose.prod.yml --env-file {REMOTE_DIR}/.env"
    )
    run(client, f"{compose} build --quiet", pty=True)
    run(client, f"{compose} up -d --remove-orphans")

    nginx_conf = "/etc/nginx/sites-available/sphere3d.ru"
    cert_path = "/etc/letsencrypt/live/sphere3d.ru/fullchain.pem"
    _, cert_out, _ = run(client, f"test -f {cert_path} && echo yes || echo no", check=False)

    sftp3 = client.open_sftp()
    sftp3.put(str(ROOT / "deploy" / "nginx" / "sphere3d.ru.conf"), "/tmp/sphere3d.ru.conf")
    sftp3.close()

    if "yes" not in cert_out:
        print("==> Временный HTTP для certbot")
        run(
            client,
            "rm -f /etc/nginx/sites-enabled/default && "
            "cp /tmp/sphere3d.ru.conf /etc/nginx/sites-available/sphere3d.ru && "
            "ln -sf /etc/nginx/sites-available/sphere3d.ru /etc/nginx/sites-enabled/sphere3d.ru",
        )
        # Bootstrap HTTP-only for certbot
        bootstrap = """
server {
    listen 80;
    listen [::]:80;
    server_name sphere3d.ru www.sphere3d.ru;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
}
"""
        sftp4 = client.open_sftp()
        with sftp4.file("/tmp/sphere3d-bootstrap.conf", "w") as f:
            f.write(bootstrap)
        sftp4.close()
        run(
            client,
            "cp /tmp/sphere3d-bootstrap.conf /etc/nginx/sites-available/sphere3d.ru && "
            "nginx -t && systemctl reload nginx",
        )
        env_lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
        cert_email = "noreply@sphere3d.ru"
        for line in env_lines:
            if line.startswith("CERTBOT_EMAIL="):
                cert_email = line.split("=", 1)[1].strip()
        run(
            client,
            f"certbot certonly --webroot -w /var/www/certbot "
            f"-d sphere3d.ru -d www.sphere3d.ru "
            f"--non-interactive --agree-tos -m {cert_email} --no-eff-email",
        )
        run(client, _nginx_ssl_snippets_cmd())
        run(
            client,
            "cp /tmp/sphere3d.ru.conf /etc/nginx/sites-available/sphere3d.ru && "
            "nginx -t && systemctl reload nginx",
        )
    else:
        run(client, _nginx_ssl_snippets_cmd())
        run(
            client,
            "cp /tmp/sphere3d.ru.conf /etc/nginx/sites-available/sphere3d.ru && "
            "ln -sf /etc/nginx/sites-available/sphere3d.ru /etc/nginx/sites-enabled/sphere3d.ru && "
            "nginx -t && systemctl reload nginx",
        )

    print("==> Smoke test")
    for _ in range(12):
        _, h, _ = run(client, "curl -sf http://127.0.0.1:8080/health", check=False)
        if '"ok"' in h:
            break
        time.sleep(5)
    else:
        print("Предупреждение: health не ответил вовремя — проверьте docker logs")

    creds = ROOT / "deploy" / "secrets" / "CREDENTIALS.txt"
    creds.write_text(
        f"""Sphere3D production — {HOST}
Сайт: https://sphere3d.ru
SSH: ssh -i deploy/keys/spherio_deploy root@{HOST}
Секреты приложения: deploy/secrets/.env.production (на сервере /opt/spherio/.env)
Деплой с ПК: deploy-to-vps.bat

Вход root по паролю отключён — только ключ deploy/keys/spherio_deploy.
Смените пароль root и SMTP в панели Timeweb (пароли светились в чате).
""",
        encoding="utf-8",
    )
    client.close()
    print(f"\nГотово: https://sphere3d.ru")
    print(f"Заметки: {creds}")


if __name__ == "__main__":
    main()
