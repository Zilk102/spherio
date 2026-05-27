#!/usr/bin/env python3
"""Создать deploy/keys/spherio_deploy без пароля (OpenSSH)."""
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

ROOT = Path(__file__).resolve().parents[1]
KEY_DIR = ROOT / "deploy" / "keys"
KEY_DIR.mkdir(parents=True, exist_ok=True)
KEY_PATH = KEY_DIR / "spherio_deploy"
PUB_PATH = KEY_DIR / "spherio_deploy.pub"

key = ed25519.Ed25519PrivateKey.generate()
priv = key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.OpenSSH,
    encryption_algorithm=serialization.NoEncryption(),
)
pub = key.public_key().public_bytes(
    encoding=serialization.Encoding.OpenSSH,
    format=serialization.PublicFormat.OpenSSH,
)
KEY_PATH.write_bytes(priv)
PUB_PATH.write_text(pub.decode() + " spherio-deploy\n", encoding="utf-8")
print("OK:", PUB_PATH)
