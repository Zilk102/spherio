import pg from "pg";

const connectionString = process.env.DATABASE_URL;

/** null, если DATABASE_URL не задан (гостевой режим без Postgres). */
export const pool: pg.Pool | null = connectionString
  ? new pg.Pool({ connectionString })
  : null;
