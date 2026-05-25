/** Базовый радиус «стартовой» сферы */
export const R0 = 0.5;

export const MIN_RADIUS = 0.5;
export const MAX_RADIUS = 8;

export const EAT_RATIO = 1.15;

export const ARENA_HALF = 50;
export const ARENA_SIZE = ARENA_HALF * 2;
export const WALL_HEIGHT = 4;

export const PELLET_COUNT = 400;
export const PELLET_RADIUS = 0.15;
export const PELLET_MASS_VALUE = 0.02;

/** Доля массы жертвы, рассыпаемая орбами на месте убийства */
export const DEATH_SCATTER_FRACTION = 0.88;
/** Доля массы, сразу переходящая убийце */
export const KILL_ABSORB_FRACTION = 0.12;
export const MAX_DEATH_SCATTER_PELLETS = 72;

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const MAX_PLAYERS = 50;
export const BOT_COUNT = 8;

export const BASE_MASS = 1;
export const GRAVITY = 9.81;

/** Верхняя грань пола */
export const GROUND_Y = 0;

/** Трение: ниже — шар реально разгоняется при качении */
export const SPHERE_FRICTION = 0.52;
export const GROUND_FRICTION = 0.58;

/** Камера: близко у маленького шара, далеко у крупного */
export const CAM_RADIUS_MIN = 13;
export const CAM_RADIUS_MAX = 68;
export const SPHERE_RESTITUTION = 0.35;

export const RESPAWN_INVULN_MS = 2000;

export const INPUT_MAX_PER_SEC = 60;
export const MAX_LINEAR_SPEED = 24;
export const MAX_ANGULAR_SPEED = 60;

/** Списание массы в секунду при boost + движении */
export const BOOST_MASS_DRAIN_PER_SEC = 0.28;
/** Множитель силы разгона при boost (при движении) */
export const BOOST_SPEED_MULTIPLIER = 2.6;
/** Потолок скорости при boost */
export const BOOST_MAX_SPEED_FACTOR = 1.55;

export const PLAYER_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6,
  0x1abc9c, 0xe91e63, 0x00bcd4, 0xff5722, 0x8bc34a,
];

/** Лайфтайм одного матча (публичного и приватного со старта). */
export const MATCH_DURATION_MS = 15 * 60 * 1000;
/** Сколько держим overlay с итогами после `match_results` до dispose комнаты. */
export const MATCH_END_HOLD_MS = 14 * 1000;
/** Сколько времени до окончания матча допускает «дотолкнуть» нового игрока в существующее публичное лобби. */
export const MATCH_REUSE_MIN_REMAINING_MS = 8 * 60 * 1000;
/** Приватное лобби живёт максимум столько без реальных игроков, потом dispose. */
export const PRIVATE_IDLE_GRACE_MS = 5 * 60 * 1000;
/** Минимум реальных игроков для старта таймера в приватном лобби. */
export const PRIVATE_MIN_HUMANS_TO_START = 2;

/** Сколько живёт «случайная цель» у игрока/бота — потом перевыбирается. */
export const TARGET_DURATION_MS = 60 * 1000;
/** Множитель массы (и соответственно очков), получаемой при поедании именно своей цели. */
export const TARGET_BONUS_MULT = 3;
