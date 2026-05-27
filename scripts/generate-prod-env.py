#!/usr/bin/env python3
"""Создаёт deploy/secrets/.env.production (не коммитится)."""
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "deploy" / "secrets" / ".env.production"
MAIL_LOCAL = ROOT / "deploy" / "secrets" / "mail.local"

POSTGRES_USER = "spherio"
POSTGRES_DB = "spherio"


def gen_password(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        print("Уже есть:", OUT)
        return

    pg_pass = gen_password(24)
    jwt = secrets.token_hex(48)

    smtp_host = "smtp.timeweb.ru"
    smtp_port = "465"
    smtp_user = "noreply@sphere3d.ru"
    smtp_pass = ""
    mail_from = "noreply@sphere3d.ru"
    if MAIL_LOCAL.exists():
        for line in MAIL_LOCAL.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if k == "SMTP_PASS":
                smtp_pass = v
            elif k == "SMTP_HOST":
                smtp_host = v
            elif k == "SMTP_PORT":
                smtp_port = v
            elif k == "SMTP_USER":
                smtp_user = v
            elif k == "MAIL_FROM":
                mail_from = v

    content = f"""# Автогенерация — не коммитить
POSTGRES_USER={POSTGRES_USER}
POSTGRES_PASSWORD={pg_pass}
POSTGRES_DB={POSTGRES_DB}
DATABASE_URL=postgresql://{POSTGRES_USER}:{pg_pass}@postgres:5432/{POSTGRES_DB}
REDIS_URL=redis://redis:6379
JWT_SECRET={jwt}
CORS_ORIGIN=https://sphere3d.ru,https://www.sphere3d.ru
VITE_COLYSEUS_ENDPOINT=wss://sphere3d.ru/colyseus
COLYSEUS_PORT=2567
SMTP_HOST={smtp_host}
SMTP_PORT={smtp_port}
SMTP_USER={smtp_user}
SMTP_PASS={smtp_pass}
MAIL_FROM={mail_from}
CERTBOT_EMAIL={mail_from}
APP_PUBLIC_URL=https://sphere3d.ru
SMTP_SECURE=true
"""
    OUT.write_text(content, encoding="utf-8")
    print("Создан:", OUT)
    if not smtp_pass:
        print("Подсказка: SMTP_PASS можно добавить в deploy/secrets/mail.local и перегенерировать.")


if __name__ == "__main__":
    main()
