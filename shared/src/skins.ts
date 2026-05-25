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

const EMOJI_SKINS: { id: string; name: string; emoji: string }[] = [
  { id: "emoji_grin", name: "Улыбка", emoji: "😀" },
  { id: "emoji_cool", name: "Крутой", emoji: "😎" },
  { id: "emoji_lol", name: "Смех", emoji: "🤣" },
  { id: "emoji_love", name: "Любовь", emoji: "😍" },
  { id: "emoji_fire", name: "Огонь", emoji: "🔥" },
  { id: "emoji_star", name: "Звезда", emoji: "⭐" },
  { id: "emoji_skull", name: "Череп", emoji: "💀" },
  { id: "emoji_ghost", name: "Призрак", emoji: "👻" },
  { id: "emoji_cat", name: "Кот", emoji: "🐱" },
  { id: "emoji_dog", name: "Собака", emoji: "🐶" },
  { id: "emoji_alien", name: "Пришелец", emoji: "👽" },
  { id: "emoji_robot", name: "Робот", emoji: "🤖" },
  { id: "emoji_pizza", name: "Пицца", emoji: "🍕" },
  { id: "emoji_earth", name: "Земля", emoji: "🌍" },
  { id: "emoji_clown", name: "Клоун", emoji: "🤡" },
  { id: "emoji_devil", name: "Дьявол", emoji: "😈" },
];

function emojiCatalog(): SkinDef[] {
  return EMOJI_SKINS.map((e) => ({
    id: e.id,
    name: e.name,
    kind: "emoji" as const,
    emoji: e.emoji,
    tintable: true,
    defaultColor: 0xffffff,
    free: true,
  }));
}

const BALL_SKINS: SkinDef[] = [
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
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => ({
    id: `ball_billiard_${n}`,
    name: `Бильярд ${n}`,
    kind: "billiard" as const,
    billiardNumber: n,
    tintable: false,
    defaultColor: billiardColor(n),
    free: true,
  })),
];

function billiardColor(n: number): number {
  const colors: Record<number, number> = {
    1: 0xf4d03f,
    2: 0x3498db,
    3: 0xe74c3c,
    4: 0x9b59b6,
    5: 0xe67e22,
    6: 0x2ecc71,
    7: 0x7f3b1b,
    8: 0x111111,
    9: 0xffff00,
    10: 0x1abc9c,
    11: 0x8e44ad,
    12: 0x2980b9,
    13: 0xff69b4,
    14: 0x006400,
    15: 0x8b0000,
  };
  return colors[n] ?? 0xcccccc;
}

export const SKIN_CATALOG: SkinDef[] = [...emojiCatalog(), ...BALL_SKINS];

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
