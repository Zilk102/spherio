#!/usr/bin/env python3
"""Донастройка nginx + Let's Encrypt (если deploy оборвался на этом шаге)."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from remote import connect, run  # type: ignore  # noqa: E402

HOST = os.environ["SPHERIO_HOST"]  # IP/hostname VPS, обязателен
ENV = ROOT / "deploy" / "secrets" / ".env.production"
cert_email = "noreply@sphere3d.ru"
if ENV.exists():
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("CERTBOT_EMAIL="):
            cert_email = line.split("=", 1)[1].strip()

client = connect()
sftp = client.open_sftp()
sftp.put(str(ROOT / "deploy" / "nginx" / "sphere3d.ru.conf"), "/tmp/sphere3d.ru.conf")
sftp.close()

cert_path = "/etc/letsencrypt/live/sphere3d.ru/fullchain.pem"
_, out, _ = run(client, f"test -f {cert_path} && echo yes || echo no", check=False)

if "yes" not in out:
    bootstrap = """
server {
    listen 80;
    listen [::]:80;
    server_name sphere3d.ru www.sphere3d.ru;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
}
"""
    sftp = client.open_sftp()
    with sftp.file("/tmp/sphere3d-bootstrap.conf", "w") as f:
        f.write(bootstrap)
    sftp.close()
    run(
        client,
        "mkdir -p /var/www/certbot && "
        "cp /tmp/sphere3d-bootstrap.conf /etc/nginx/sites-available/sphere3d.ru && "
        "ln -sf /etc/nginx/sites-available/sphere3d.ru /etc/nginx/sites-enabled/sphere3d.ru && "
        "rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx",
    )
    run(
        client,
        f"certbot certonly --webroot -w /var/www/certbot "
        f"-d sphere3d.ru -d www.sphere3d.ru "
        f"--non-interactive --agree-tos -m {cert_email} --no-eff-email",
    )

run(
    client,
    "cp /tmp/sphere3d.ru.conf /etc/nginx/sites-available/sphere3d.ru && "
    "ln -sf /etc/nginx/sites-available/sphere3d.ru /etc/nginx/sites-enabled/sphere3d.ru && "
    "nginx -t && systemctl reload nginx",
)
run(client, "curl -sfI https://sphere3d.ru/health | head -5", check=False)
client.close()
print("nginx + SSL готовы")
