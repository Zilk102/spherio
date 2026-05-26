import { scoreFromRadius } from "@spherio/shared";
import type { UserStats } from "@spherio/shared";
import { pool } from "../db/pool.js";

const guestStats = new Map<string, UserStats>();

const EMPTY: UserStats = {
  gamesPlayed: 0,
  kills: 0,
  deaths: 0,
  bestScore: 0,
  totalTimeSec: 0,
  coins: 500,
};

export function defaultStats(): UserStats {
  return { ...EMPTY, coins: 500 };
}

export async function getStats(userId: string, guest: boolean): Promise<UserStats> {
  if (guest) {
    return guestStats.get(userId) ?? defaultStats();
  }
  if (!pool) return defaultStats();
  const r = await pool.query<{
    games_played: number;
    kills: number;
    deaths: number;
    best_score: number;
    total_time_sec: number;
    coins: number;
  }>(
    `SELECT games_played, kills, deaths, best_score, total_time_sec, coins
     FROM user_stats WHERE user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return defaultStats();
  return {
    gamesPlayed: row.games_played,
    kills: row.kills,
    deaths: row.deaths,
    bestScore: row.best_score,
    totalTimeSec: row.total_time_sec,
    coins: row.coins,
  };
}

export async function ensureStatsRow(userId: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

export async function recordMatchEnd(
  userId: string,
  guest: boolean,
  data: { kills: number; deaths: number; bestRadius: number; timeSec: number },
): Promise<UserStats> {
  const score = scoreFromRadius(data.bestRadius);
  const coinGain = 10 + data.kills * 25;

  if (guest) {
    const prev = guestStats.get(userId) ?? defaultStats();
    const next: UserStats = {
      gamesPlayed: prev.gamesPlayed + 1,
      kills: prev.kills + data.kills,
      deaths: prev.deaths + data.deaths,
      bestScore: Math.max(prev.bestScore, score),
      totalTimeSec: prev.totalTimeSec + data.timeSec,
      coins: prev.coins + coinGain,
    };
    guestStats.set(userId, next);
    return next;
  }

  if (!pool) return defaultStats();
  try {
    await ensureStatsRow(userId);
    await pool.query(
      `UPDATE user_stats SET
        games_played = games_played + 1,
        kills = kills + $2,
        deaths = deaths + $3,
        best_score = GREATEST(best_score, $4),
        total_time_sec = total_time_sec + $5,
        coins = coins + $6,
        updated_at = NOW()
       WHERE user_id = $1`,
      [userId, data.kills, data.deaths, score, data.timeSec, coinGain],
    );
    return getStats(userId, false);
  } catch (err) {
    console.error("[stats] recordMatchEnd failed:", err);
    throw err;
  }
}

export async function spendCoins(userId: string, amount: number): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(
    `UPDATE user_stats SET coins = coins - $2, updated_at = NOW()
     WHERE user_id = $1 AND coins >= $2`,
    [userId, amount],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function addCoins(userId: string, amount: number): Promise<void> {
  if (!pool) return;
  await ensureStatsRow(userId);
  await pool.query(
    `UPDATE user_stats SET coins = coins + $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, amount],
  );
}

export function adjustGuestCoins(userId: string, delta: number): boolean {
  const prev = guestStats.get(userId) ?? defaultStats();
  if (prev.coins + delta < 0) return false;
  guestStats.set(userId, { ...prev, coins: prev.coins + delta });
  return true;
}
