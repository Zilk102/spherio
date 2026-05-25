import { getSkin, isFreeSkin, skinShopPrice } from "@spherio/shared";
import type { ShopBuyResponse } from "@spherio/shared";
import { pool } from "../db/pool.js";
import { adjustGuestCoins, getStats } from "./stats.js";
import { getGuest } from "./auth.js";

export async function buySkin(
  userId: string,
  guest: boolean,
  skinId: string,
): Promise<ShopBuyResponse | null> {
  const skin = getSkin(skinId);
  if (!skin || isFreeSkin(skinId)) return null;
  const price = skinShopPrice(skinId);
  if (price == null) return null;

  if (guest) {
    const g = getGuest(userId);
    if (!g) return null;
    if (g.ownedSkinIds.includes(skinId)) {
      const stats = await getStats(userId, true);
      return { ok: true, ownedSkinIds: [...g.ownedSkinIds], coins: stats.coins };
    }
    if (!adjustGuestCoins(userId, -price)) return null;
    g.ownedSkinIds = [...g.ownedSkinIds, skinId];
    const stats = await getStats(userId, true);
    return { ok: true, ownedSkinIds: g.ownedSkinIds, coins: stats.coins };
  }

  if (!pool) return null;
  const u = await pool.query<{ owned_skin_ids: string[] }>(
    `SELECT owned_skin_ids FROM users WHERE id = $1 AND is_guest = false`,
    [userId],
  );
  const row = u.rows[0];
  if (!row) return null;
  const owned = row.owned_skin_ids ?? [];
  if (owned.includes(skinId)) {
    const stats = await getStats(userId, false);
    return { ok: true, ownedSkinIds: owned, coins: stats.coins };
  }
  const { spendCoins } = await import("./stats.js");
  const ok = await spendCoins(userId, price);
  if (!ok) return null;
  const next = [...owned, skinId];
  await pool.query(`UPDATE users SET owned_skin_ids = $2::jsonb WHERE id = $1`, [
    userId,
    JSON.stringify(next),
  ]);
  const stats = await getStats(userId, false);
  return { ok: true, ownedSkinIds: next, coins: stats.coins };
}
