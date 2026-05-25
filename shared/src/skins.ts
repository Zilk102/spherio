export type SkinKind =
  | "emoji"
  | "football"
  | "basketball"
  | "volleyball"
  | "bowling"
  | "billiard";

export interface SkinDef {
  id: string;
  name: string;
  kind: SkinKind;
  /** Для emoji-скинов */
  emoji?: string;
  /** Номер на бильярдном шаре 1–15 */
  billiardNumber?: number;
  /** Можно перекрасить в меню */
  tintable: boolean;
  /** Цвет по умолчанию, если игрок не выбрал */
  defaultColor: number;
  free: boolean;
}

export const DEFAULT_SKIN_ID = "emoji_grin";

/** Палитра для случайного цвета ботов и выбора в меню */
export const SKIN_TINT_PALETTE: number[] = [
  0xe74c3c, 0xe67e22, 0xf1c40f, 0x2ecc71, 0x1abc9c,
  0x3498db, 0x9b59b6, 0xe91e63, 0xffffff, 0x95a5a6,
  0xff6b6b, 0x4ecdc4, 0xffe66d, 0x6c5ce7, 0xfd79a8,
];

/**
 * 10 проработанных скинов — мячи рисуем процедурно по нормали сферы,
 * эмодзи кладём поверх PBR-подобного шара через Babylon CreateDecal.
 */
export const SKIN_CATALOG: SkinDef[] = [
  // ─── Спортивные мячи ──────────────────────────────
  {
    id: "ball_football",
    name: "Футбол",
    kind: "football",
    tintable: false,
    defaultColor: 0xffffff,
    free: true,
  },
  {
    id: "ball_basketball",
    name: "Баскетбол",
    kind: "basketball",
    tintable: false,
    defaultColor: 0xe67e22,
    free: true,
  },
  {
    id: "ball_volleyball",
    name: "Волейбол",
    kind: "volleyball",
    tintable: false,
    defaultColor: 0xf5f5f5,
    free: true,
  },
  {
    id: "ball_bowling",
    name: "Боулинг",
    kind: "bowling",
    tintable: true,
    defaultColor: 0x1a1a2e,
    free: true,
  },
  {
    id: "ball_8ball",
    name: "Восьмёрка",
    kind: "billiard",
    billiardNumber: 8,
    tintable: false,
    defaultColor: 0x111111,
    free: true,
  },
  // ─── Эмодзи‑шарики (PBR + decal) ─────────────────
  {
    id: "emoji_grin",
    name: "Улыбка",
    kind: "emoji",
    emoji: "😀",
    tintable: true,
    defaultColor: 0xfcd53f,
    free: true,
  },
  {
    id: "emoji_cool",
    name: "Крутой",
    kind: "emoji",
    emoji: "😎",
    tintable: true,
    defaultColor: 0xfcd53f,
    free: true,
  },
  {
    id: "emoji_fire",
    name: "Огонь",
    kind: "emoji",
    emoji: "🔥",
    tintable: true,
    defaultColor: 0xff7b1c,
    free: true,
  },
  {
    id: "emoji_star",
    name: "Звезда",
    kind: "emoji",
    emoji: "⭐",
    tintable: true,
    defaultColor: 0x2a2540,
    free: true,
  },
  {
    id: "emoji_alien",
    name: "Пришелец",
    kind: "emoji",
    emoji: "👽",
    tintable: true,
    defaultColor: 0x6cc551,
    free: true,
  },
];

export function getSkin(id: string): SkinDef | undefined {
  return SKIN_CATALOG.find((s) => s.id === id);
}

export function skinColor(id: string, fallback = 0xffffff): number {
  return getSkin(id)?.defaultColor ?? fallback;
}

export function isFreeSkin(id: string): boolean {
  const s = getSkin(id);
  return s?.free ?? false;
}

export function listFreeSkins(): SkinDef[] {
  return SKIN_CATALOG.filter((s) => s.free);
}

export function listSkinsForUser(ownedSkinIds: string[]): SkinDef[] {
  const owned = new Set(ownedSkinIds);
  return SKIN_CATALOG.filter((s) => s.free || owned.has(s.id));
}

export function listAllSkinIds(): string[] {
  return SKIN_CATALOG.map((s) => s.id);
}

export function randomTintColor(): number {
  return SKIN_TINT_PALETTE[Math.floor(Math.random() * SKIN_TINT_PALETTE.length)]!;
}

export function randomBotAppearance(): { skinId: string; color: number } {
  const ids = listAllSkinIds();
  const skinId = ids[Math.floor(Math.random() * ids.length)] ?? DEFAULT_SKIN_ID;
  const skin = getSkin(skinId);
  return {
    skinId,
    color: skin?.tintable ? randomTintColor() : skin?.defaultColor ?? 0xffffff,
  };
}

export function resolveSkinColor(skinId: string, requested?: number): number {
  const skin = getSkin(skinId);
  if (!skin) return requested ?? 0xffffff;
  if (!skin.tintable) return skin.defaultColor;
  if (requested != null && requested > 0) return requested & 0xffffff;
  return skin.defaultColor;
}

/** @deprecated — только для старых ссылок */
export type SkinPattern = "solid" | "stripes" | "glow" | "matte";

export const SKIN_SHOP_PRICES: Record<string, number> = {};

export function skinShopPrice(_id: string): number | null {
  return null;
}
