#!/usr/bin/env node
/**
 * Однократно: копирует deploy-ключ на VPS (пароль только через env SSH_BOOTSTRAP_PASS).
 * node scripts/ssh-bootstrap.mjs root@<server-ip>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "ssh2";

const host = process.argv[2] ?? `root@${process.env.SPHERIO_HOST}`;
const password = process.env.SSH_BOOTSTRAP_PASS;
if (!password) {
  console.error("Задайте SSH_BOOTSTRAP_PASS (пароль root, один раз).");
  process.exit(1);
}

const [user, hostname] = host.includes("@") ? host.split("@") : ["root", host];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pubPath = path.join(root, "deploy", "keys", "spherio_deploy.pub");
const pub = fs.readFileSync(pubPath, "utf8").trim();

const conn = new Client();
conn
  .on("ready", () => {
    const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qF '${pub.split("'").join("'\\''")}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub.split("'").join("'\\''")}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      stream
        .on("close", (code) => {
          conn.end();
          if (code === 0) console.log("SSH-ключ установлен на", hostname);
          else process.exit(code ?? 1);
        })
        .stderr.on("data", (d) => process.stderr.write(d));
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({
    host: hostname,
    port: 22,
    username: user,
    password,
    tryKeyboard: true,
    readyTimeout: 20000,
  });
