/** Базовый радиус «стартовой» сферы */
export const R0 = 0.5;

export const MIN_RADIUS = 0.5;
export const MAX_RADIUS = 8;

/** Можно съесть игрока, если radius >= victim * EAT_RATIO */
export const EAT_RATIO = 1.15;

export const ARENA_HALF = 50;
export const ARENA_SIZE = ARENA_HALF * 2;
export const WALL_HEIGHT = 4;

export const PELLET_COUNT = 400;
export const PELLET_RADIUS = 0.15;
export const PELLET_MASS_VALUE = 0.02;

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const MAX_PLAYERS = 50;
export const BOT_COUNT = 8;

export const BASE_MASS = 1;
export const BASE_TORQUE = 0.35;
export const BRAKE_STRENGTH = 0.12;

export const SPHERE_FRICTION = 1.4;
export const SPHERE_RESTITUTION = 0.05;

export const RESPAWN_INVULN_MS = 2000;

export const INPUT_MAX_PER_SEC = 60;
export const MAX_LINEAR_SPEED = 28;
export const MAX_ANGULAR_SPEED = 40;

export const PLAYER_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6,
  0x1abc9c, 0xe91e63, 0x00bcd4, 0xff5722, 0x8bc34a,
];
