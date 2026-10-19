#!/usr/bin/env python3
"""Однократно: SSH-ключ на VPS. Пароль: env SSH_BOOTSTRAP_PASS."""
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
PUB = (ROOT / "deploy" / "keys" / "spherio_deploy.pub").read_text(encoding="utf-8").strip()
HOST = sys.argv[1] if len(sys.argv) > 1 else os.environ["SPHERIO_HOST"]
USER = "root"
PASSWORD = os.environ.get("SSH_BOOTSTRAP_PASS")
if not PASSWORD:
    print("Задайте SSH_BOOTSTRAP_PASS", file=sys.stderr)
    sys.exit(1)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=25)
cmd = (
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
    f"grep -qF '{PUB}' ~/.ssh/authorized_keys 2>/dev/null || "
    f"echo '{PUB}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
)
_, stdout, stderr = client.exec_command(cmd)
err = stderr.read().decode()
out = stdout.read().decode()
code = stdout.channel.recv_exit_status()
client.close()
if err:
    print(err, file=sys.stderr)
if code != 0:
    sys.exit(code)
print("SSH-ключ установлен на", HOST)
if out.strip():
    print(out.strip())
