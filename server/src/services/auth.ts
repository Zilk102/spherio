import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  DEFAULT_SKIN_ID,
  getSkin,
  isFreeSkin,
  listFreeSkins,
  type AuthResponse,
  type GuestAuthRequest,
  type LoginRequest,
  type PatchProfileRequest,
  type ProfileResponse,
  type RegisterRequest,
} from "@spherio/shared";
import { pool } from "../db/pool.js";
import { ensureStatsRow, getStats } from "./stats.js";

export interface GuestUser {
  userId: string;
  displayName: string;
  equippedSkinId: string;
  ownedSkinIds: string[];
}

export interface VerifiedToken {
  userId: string;
  guest: boolean;
}

const guests = new Map<string, GuestUser>();

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

function freeSkinIds(): string[] {
  return listFreeSkins().map((s) => s.id);
}

function signAccessToken(userId: string, guest: boolean): string {
  return jwt.sign({ sub: userId, guest, typ: "access" }, JWT_SECRET, { expiresIn: "2h" });
}

function signRefreshToken(userId: string, guest: boolean): string {
  return jwt.sign({ sub: userId, guest, typ: "refresh" }, JWT_SECRET, { expiresIn: "30d" });
}

function toAuthResponse(user: {
  userId: string;
  displayName: string;
  equippedSkinId: string;
  ownedSkinIds: string[];
  guest: boolean;
}): AuthResponse {
  return {
    token: signAccessToken(user.userId, user.guest),
    refreshToken: signRefreshToken(user.userId, user.guest),
    userId: user.userId,
    displayName: user.displayName,
    equippedSkinId: user.equippedSkinId,
    ownedSkinIds: user.ownedSkinIds,
  };
}

/** Декодирует JWT access/refresh или legacy base64url гостевой токен. */
export function verifyToken(token: string): VerifiedToken | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      sub?: string;
      guest?: boolean;
      typ?: string;
    };
    if (!payload.sub) return null;
    if (payload.typ && payload.typ !== "access" && payload.typ !== "refresh") return null;
    return { userId: payload.sub, guest: !!payload.guest };
  } catch {
    try {
      const json = Buffer.from(token, "base64url").toString("utf8");
      const data = JSON.parse(json) as { sub?: string };
      if (!data.sub) return null;
      return { userId: data.sub, guest: true };
    } catch {
      return null;
    }
  }
}

export async function refreshAuth(refreshToken: string): Promise<AuthResponse | null> {
  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET) as {
      sub?: string;
      guest?: boolean;
      typ?: string;
    };
    if (!payload.sub || payload.typ !== "refresh") return null;
    if (payload.guest) {
      const g = guests.get(payload.sub);
      if (!g) return null;
      return toAuthResponse({ ...g, guest: true });
    }
    if (!pool) return null;
    const r = await pool.query<{
      id: string;
      display_name: string;
      equipped_skin_id: string;
      owned_skin_ids: string[];
    }>(
      `SELECT id, display_name, equipped_skin_id, owned_skin_ids
       FROM users WHERE id = $1 AND is_guest = false`,
      [payload.sub],
    );
    const row = r.rows[0];
    if (!row) return null;
    return toAuthResponse({
      userId: row.id,
      displayName: row.display_name,
      equippedSkinId: row.equipped_skin_id,
      ownedSkinIds: row.owned_skin_ids,
      guest: false,
    });
  } catch {
    return null;
  }
}

function mergeOwned(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])];
}

function rowToAuth(row: {
  id: string;
  display_name: string;
  equipped_skin_id: string;
  owned_skin_ids: string[];
}): AuthResponse {
  return toAuthResponse({
    userId: row.id,
    displayName: row.display_name,
    equippedSkinId: row.equipped_skin_id,
    ownedSkinIds: row.owned_skin_ids,
    guest: false,
  });
}

export function createGuest(req: GuestAuthRequest): AuthResponse {
  const userId = randomUUID();
  const displayName = (req.displayName?.trim() || `Гость${userId.slice(0, 4)}`).slice(0, 16);
  const ownedSkinIds = freeSkinIds();
  const user: GuestUser = {
    userId,
    displayName,
    equippedSkinId: DEFAULT_SKIN_ID,
    ownedSkinIds,
  };
  guests.set(userId, user);
  return toAuthResponse({ ...user, guest: true });
}

export function getGuest(userId: string): GuestUser | undefined {
  return guests.get(userId);
}

export async function register(req: RegisterRequest): Promise<AuthResponse> {
  if (!pool) throw new Error("database_unavailable");
  const email = req.email?.trim().toLowerCase();
  const password = req.password ?? "";
  const displayName = (req.displayName?.trim() || email?.split("@")[0] || "Игрок").slice(0, 16);
  if (!email || password.length < 6) {
    throw new Error("invalid_credentials");
  }
  let ownedSkinIds = freeSkinIds();
  if (req.guestUserId) {
    const g = guests.get(req.guestUserId);
    if (g) ownedSkinIds = mergeOwned(ownedSkinIds, g.ownedSkinIds);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query<{
    id: string;
    display_name: string;
    equipped_skin_id: string;
    owned_skin_ids: string[];
  }>(
    `INSERT INTO users (email, password_hash, display_name, equipped_skin_id, owned_skin_ids, is_guest)
     VALUES ($1, $2, $3, $4, $5::jsonb, false)
     RETURNING id, display_name, equipped_skin_id, owned_skin_ids`,
    [email, passwordHash, displayName, DEFAULT_SKIN_ID, JSON.stringify(ownedSkinIds)],
  );
  const row = result.rows[0];
  if (!row) throw new Error("register_failed");
  await ensureStatsRow(row.id);
  if (req.guestUserId) guests.delete(req.guestUserId);
  return rowToAuth(row);
}

export async function login(req: LoginRequest): Promise<AuthResponse | null> {
  if (!pool) throw new Error("database_unavailable");
  const email = req.email?.trim().toLowerCase();
  const password = req.password ?? "";
  if (!email || !password) return null;
  const result = await pool.query<{
    id: string;
    display_name: string;
    equipped_skin_id: string;
    owned_skin_ids: string[];
    password_hash: string;
  }>(
    `SELECT id, display_name, equipped_skin_id, owned_skin_ids, password_hash
     FROM users WHERE email = $1 AND is_guest = false`,
    [email],
  );
  const row = result.rows[0];
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  if (req.guestUserId) {
    const g = guests.get(req.guestUserId);
    if (g) {
      const merged = mergeOwned(row.owned_skin_ids, g.ownedSkinIds);
      await pool.query(`UPDATE users SET owned_skin_ids = $2::jsonb WHERE id = $1`, [
        row.id,
        JSON.stringify(merged),
      ]);
      row.owned_skin_ids = merged;
      guests.delete(req.guestUserId);
    }
  }
  return rowToAuth(row);
}

export async function getProfile(userId: string, guest: boolean): Promise<ProfileResponse | null> {
  const stats = await getStats(userId, guest);
  if (guest) {
    const g = guests.get(userId);
    if (!g) return null;
    return {
      userId: g.userId,
      displayName: g.displayName,
      equippedSkinId: g.equippedSkinId,
      ownedSkinIds: g.ownedSkinIds,
      guest: true,
      stats,
    };
  }
  if (!pool) return null;
  const result = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    equipped_skin_id: string;
    owned_skin_ids: string[];
  }>(
    `SELECT id, email, display_name, equipped_skin_id, owned_skin_ids
     FROM users WHERE id = $1 AND is_guest = false`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    equippedSkinId: row.equipped_skin_id,
    ownedSkinIds: row.owned_skin_ids,
    guest: false,
    stats,
  };
}

export async function patchProfile(
  userId: string,
  guest: boolean,
  patch: PatchProfileRequest,
): Promise<ProfileResponse | null> {
  if (guest) {
    const g = guests.get(userId);
    if (!g) return null;
    if (patch.displayName) g.displayName = patch.displayName.trim().slice(0, 16);
    if (patch.equippedSkinId) {
      const id = patch.equippedSkinId;
      if (g.ownedSkinIds.includes(id) || isFreeSkin(id)) g.equippedSkinId = id;
    }
    return getProfile(userId, true);
  }
  if (!pool) return null;
  if (patch.equippedSkinId) {
    const id = patch.equippedSkinId;
    const u = await pool.query<{ owned_skin_ids: string[] }>(
      `SELECT owned_skin_ids FROM users WHERE id = $1`,
      [userId],
    );
    const owned = u.rows[0]?.owned_skin_ids ?? [];
    if (!owned.includes(id) && !isFreeSkin(id)) return null;
    if (!getSkin(id)) return null;
  }
  await pool.query(
    `UPDATE users SET
      display_name = COALESCE($2, display_name),
      equipped_skin_id = COALESCE($3, equipped_skin_id)
     WHERE id = $1 AND is_guest = false`,
    [
      userId,
      patch.displayName?.trim().slice(0, 16) ?? null,
      patch.equippedSkinId ?? null,
    ],
  );
  return getProfile(userId, false);
}

export function resolveOwnedSkins(
  token: string | undefined,
  requestedSkinId: string | undefined,
): { skinId: string; owned: string[] } {
  const fallback = requestedSkinId ?? DEFAULT_SKIN_ID;
  if (!token) return { skinId: fallback, owned: freeSkinIds() };
  const v = verifyToken(token);
  if (!v) return { skinId: fallback, owned: freeSkinIds() };
  if (v.guest) {
    const g = guests.get(v.userId);
    const owned = g?.ownedSkinIds ?? freeSkinIds();
    const skinId =
      requestedSkinId && (owned.includes(requestedSkinId) || isFreeSkin(requestedSkinId))
        ? requestedSkinId
        : g?.equippedSkinId ?? fallback;
    return { skinId, owned };
  }
  return { skinId: fallback, owned: freeSkinIds() };
}
