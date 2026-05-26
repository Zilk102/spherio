import type { FriendEntry } from "@spherio/shared";
import { pool } from "../db/pool.js";

/** Dev-fallback, если DATABASE_URL не задан. Не синхронизируется с Postgres. */
const memory = new Map<string, Set<string>>();
let memoryFallbackWarned = false;

function warnMemoryFallback(operation: string): void {
  if (memoryFallbackWarned) return;
  memoryFallbackWarned = true;
  console.warn(
    `[friends] DATABASE_URL недоступен — "${operation}" пишет в in-memory Map процесса. ` +
      "Данные не попадут в Postgres и не переживут рестарт. Только для локальной разработки.",
  );
}

function memAdd(userId: string, friendId: string): void {
  let a = memory.get(userId);
  if (!a) {
    a = new Set();
    memory.set(userId, a);
  }
  a.add(friendId);
  let b = memory.get(friendId);
  if (!b) {
    b = new Set();
    memory.set(friendId, b);
  }
  b.add(userId);
}

function memList(userId: string): string[] {
  return [...(memory.get(userId) ?? [])];
}

export async function listFriends(userId: string): Promise<FriendEntry[]> {
  if (!pool) {
    warnMemoryFallback("listFriends");
    return memList(userId).map((id) => ({ userId: id, displayName: id.slice(0, 8) }));
  }
  const r = await pool.query<{ friend_id: string; display_name: string }>(
    `SELECT f.friend_id, u.display_name
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [userId],
  );
  return r.rows.map((row) => ({
    userId: row.friend_id,
    displayName: row.display_name,
  }));
}

export async function addFriend(userId: string, friendId: string): Promise<boolean> {
  if (!friendId || friendId === userId) return false;
  if (!pool) {
    warnMemoryFallback("addFriend");
    memAdd(userId, friendId);
    return true;
  }
  try {
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)
       ON CONFLICT DO NOTHING`,
      [userId, friendId],
    );
    return true;
  } catch (err) {
    console.error("[friends] addFriend failed:", err);
    return false;
  }
}

export async function removeFriend(userId: string, friendId: string): Promise<void> {
  if (!pool) {
    warnMemoryFallback("removeFriend");
    memory.get(userId)?.delete(friendId);
    memory.get(friendId)?.delete(userId);
    return;
  }
  try {
    await pool.query(
      `DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [userId, friendId],
    );
  } catch (err) {
    console.error("[friends] removeFriend failed:", err);
    throw err;
  }
}
