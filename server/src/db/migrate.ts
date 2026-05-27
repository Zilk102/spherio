import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Применяет схему. Делает несколько попыток с экспоненциальным backoff —
 * в docker compose healthcheck нас обычно покрывает, но при локальном
 * запуске сервера до полного прогрева Postgres первая попытка может упасть.
 */
export async function migrate(opts: { retries?: number } = {}): Promise<void> {
  if (!pool) {
    console.warn("[DB] DATABASE_URL не задан — миграция пропущена");
    return;
  }
  const sql = readFileSync(join(__dirname, "init.sql"), "utf8");
  const retries = opts.retries ?? 10;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(sql);
      const migDir = join(__dirname, "migrations");
      try {
        const files = readdirSync(migDir)
          .filter((f) => f.endsWith(".sql"))
          .sort();
        for (const f of files) {
          const migSql = readFileSync(join(migDir, f), "utf8");
          await pool.query(migSql);
          console.log(`[DB] Миграция ${f}`);
        }
      } catch (e) {
        const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : "";
        if (code !== "ENOENT") throw e;
      }
      console.log(`[DB] Схема применена (попытка ${attempt})`);
      return;
    } catch (err) {
      lastErr = err;
      const delayMs = Math.min(5000, 250 * 2 ** (attempt - 1));
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[DB] migrate попытка ${attempt}/${retries} не удалась: ${msg}. Повтор через ${delayMs} мс`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr ?? new Error("[DB] migrate провалился");
}
