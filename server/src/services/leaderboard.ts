import { scoreFromRadius } from "@spherio/shared";
import type { LeaderboardEntry, LeaderboardResponse } from "@spherio/shared";
import { createClient, type RedisClientType } from "redis";

interface Row {
  userId: string;
  displayName: string;
  score: number;
}

const allTime = new Map<string, Row>();
const daily = new Map<string, Row>();
let dailyKey = todayKey();

let redisClient: RedisClientType | null = null;
let redisReady: Promise<RedisClientType | null> | null = null;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function touchDaily(): void {
  const k = todayKey();
  if (k !== dailyKey) {
    daily.clear();
    dailyKey = k;
  }
}

async function getRedis(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;
  if (redisReady) return redisReady;
  redisReady = (async () => {
    try {
      const client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
      client.on("error", (err) => console.warn("[Redis]", err.message));
      await client.connect();
      redisClient = client;
      return client;
    } catch (e) {
      console.warn("[Redis] Недоступен, in-memory fallback:", e);
      return null;
    }
  })();
  return redisReady;
}

function memorySubmit(userId: string, displayName: string, score: number): void {
  touchDaily();
  const row = { userId, displayName: displayName.slice(0, 16), score };
  const prev = allTime.get(userId);
  if (!prev || score > prev.score) allTime.set(userId, row);
  const prevD = daily.get(userId);
  if (!prevD || score > prevD.score) daily.set(userId, row);
}

function memoryEntries(map: Map<string, Row>, limit: number): LeaderboardEntry[] {
  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      displayName: r.displayName,
      score: r.score,
    }));
}

export async function submitScore(
  userId: string,
  displayName: string,
  radius: number,
): Promise<void> {
  const score = scoreFromRadius(radius);
  const name = displayName.slice(0, 16);
  const redis = await getRedis();
  if (redis) {
    const day = todayKey();
    const pipe = redis.multi();
    pipe.zAdd("lb:all", { score, value: userId }, { GT: true });
    pipe.zAdd(`lb:daily:${day}`, { score, value: userId }, { GT: true });
    pipe.hSet("lb:names", userId, name);
    await pipe.exec();
    return;
  }
  memorySubmit(userId, name, score);
}

async function redisTop(key: string, limit: number): Promise<LeaderboardEntry[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const ids = await redis.zRange(key, 0, limit - 1, { REV: true });
  if (ids.length === 0) return [];
  const names = await redis.hmGet("lb:names", ids);
  const scores = await Promise.all(ids.map((id) => redis.zScore(key, id)));
  return ids.map((userId, i) => ({
    rank: i + 1,
    userId,
    displayName: names[i] ?? "Игрок",
    score: scores[i] ?? 0,
  }));
}

export async function getLeaderboard(
  period: "all" | "daily",
  limit = 20,
): Promise<LeaderboardResponse> {
  touchDaily();
  const redis = await getRedis();
  if (redis) {
    const key = period === "daily" ? `lb:daily:${todayKey()}` : "lb:all";
    return { period, entries: await redisTop(key, limit) };
  }
  return {
    period,
    entries: memoryEntries(period === "daily" ? daily : allTime, limit),
  };
}
