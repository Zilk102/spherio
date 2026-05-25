import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  if (!pool) {
    console.warn("[DB] DATABASE_URL не задан — миграция пропущена");
    return;
  }
  const sql = readFileSync(join(__dirname, "init.sql"), "utf8");
  await pool.query(sql);
  console.log("[DB] Схема применена");
}
