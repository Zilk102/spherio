import type { FriendEntry } from "@spherio/shared";
import { pool } from "../db/pool.js";

const memory = new Map<string, Set<string>>();

function memList(userId: string): string[] {
  return [...(memory.get(userId) ?? [])];
}

export async function listFriends(userId: string): Promise<FriendEntry[]> {
  if (!pool) {
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
    memory.set(userId, (memory.get(userId) ?? new Set()).add(friendId));
    memory.set(friendId, (memory.get(friendId) ?? new Set()).add(userId));
    return true;
  }
  try {
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)
       ON CONFLICT DO NOTHING`,
      [userId, friendId],
    );
    return true;
  } catch {
    return false;
  }
}

export async function removeFriend(userId: string, friendId: string): Promise<void> {
  if (!pool) {
    memory.get(userId)?.delete(friendId);
    memory.get(friendId)?.delete(userId);
    return;
  }
  await pool.query(
    `DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [userId, friendId],
  );
}
