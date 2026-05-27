#!/usr/bin/env python3
"""SSH на VPS по deploy-ключу (paramiko). Usage: python scripts/remote.py [--pw] 'cmd'"""
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
KEY = ROOT / "deploy" / "keys" / "spherio_deploy"
HOST = os.environ.get("SPHERIO_HOST", "5.42.98.55")
USER = os.environ.get("SPHERIO_SSH_USER", "root")
USE_PASSWORD = "--pw" in sys.argv
ARGS = [a for a in sys.argv[1:] if a != "--pw"]
CMD = " ".join(ARGS) if ARGS else "echo ok"


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    if USE_PASSWORD:
        pw = os.environ.get("SSH_BOOTSTRAP_PASS")
        if not pw:
            raise SystemExit("SSH_BOOTSTRAP_PASS")
        c.connect(HOST, username=USER, password=pw, timeout=30)
    else:
        pkey = paramiko.Ed25519Key.from_private_key_file(str(KEY))
        c.connect(HOST, username=USER, pkey=pkey, timeout=30, look_for_keys=False, allow_agent=False)
    return c


def run(client: paramiko.SSHClient, cmd: str, check: bool = True) -> tuple[int, str, str]:
    print(f"\n$ {cmd}")
    _, stdout, stderr = client.exec_command(cmd, get_pty=True)
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
    c = connect()
    _, stdout, stderr = c.exec_command(CMD, get_pty=True)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    c.close()
    if out:
        sys.stdout.write(out)
    if err:
        sys.stderr.write(err)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
