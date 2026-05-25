import {
  DEFAULT_SKIN_ID,
  getSkin,
  isFreeSkin,
  resolveSkinColor,
} from "@spherio/shared";

export function resolveSkinForJoin(
  requested: string | undefined,
  ownedSkinIds: string[],
): string {
  if (!requested) return DEFAULT_SKIN_ID;
  const skin = getSkin(requested);
  if (!skin) return DEFAULT_SKIN_ID;
  if (skin.free || ownedSkinIds.includes(requested)) return skin.id;
  return DEFAULT_SKIN_ID;
}

/** @deprecated */
export function resolveSkinId(requested?: string): string {
  return resolveSkinForJoin(requested, []);
}

export function colorForSkin(skinId: string, requested?: number): number {
  return resolveSkinColor(skinId, requested);
}

export function ownedFromAuth(
  token: string | undefined,
  getGuest: (id: string) => { ownedSkinIds: string[] } | undefined,
  verify: (t: string) => { userId: string; guest: boolean } | null,
  freeIds: () => string[],
): string[] {
  if (!token) return freeIds();
  const v = verify(token);
  if (!v) return freeIds();
  if (v.guest) return getGuest(v.userId)?.ownedSkinIds ?? freeIds();
  return freeIds();
}
