/** Тип орба на арене (зелёный — базовый, синий/красный — реже и ценнее). */
export enum PelletKind {
  Green = 0,
  Blue = 1,
  Red = 2,
}

export interface PelletKindDef {
  radius: number;
  /** Масса при поедании (очки ∝ массе). */
  massValue: number;
  /** Вес при случайном спавне / респавне. */
  spawnWeight: number;
}

export const PELLET_KIND_DEF: Record<PelletKind, PelletKindDef> = {
  [PelletKind.Green]: {
    radius: 0.15,
    massValue: 0.02,
    spawnWeight: 76,
  },
  [PelletKind.Blue]: {
    radius: 0.2,
    massValue: 0.06,
    spawnWeight: 18,
  },
  [PelletKind.Red]: {
    radius: 0.28,
    massValue: 0.12,
    spawnWeight: 6,
  },
};

const SPAWN_WEIGHT_TOTAL =
  PELLET_KIND_DEF[PelletKind.Green].spawnWeight +
  PELLET_KIND_DEF[PelletKind.Blue].spawnWeight +
  PELLET_KIND_DEF[PelletKind.Red].spawnWeight;

export function pickRandomPelletKind(): PelletKind {
  let r = Math.random() * SPAWN_WEIGHT_TOTAL;
  for (const kind of [PelletKind.Green, PelletKind.Blue, PelletKind.Red]) {
    r -= PELLET_KIND_DEF[kind].spawnWeight;
    if (r <= 0) return kind;
  }
  return PelletKind.Green;
}

export function pelletRadiusForKind(kind: PelletKind): number {
  return PELLET_KIND_DEF[kind]?.radius ?? PELLET_KIND_DEF[PelletKind.Green].radius;
}

export function pelletMassForKind(kind: PelletKind): number {
  return PELLET_KIND_DEF[kind]?.massValue ?? PELLET_KIND_DEF[PelletKind.Green].massValue;
}
