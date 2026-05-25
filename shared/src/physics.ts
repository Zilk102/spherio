import {
  BASE_MASS,
  CAM_RADIUS_MAX,
  CAM_RADIUS_MIN,
  GRAVITY,
  MAX_LINEAR_SPEED,
  MAX_RADIUS,
  MIN_RADIUS,
  R0,
} from "./constants.js";

export function clampRadius(r: number): number {
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, r));
}

export function massFromRadius(r: number): number {
  return BASE_MASS * (r / R0) ** 3;
}

/** Игровые очки для HUD (масса × 100). */
export function scoreFromRadius(r: number): number {
  return Math.round(massFromRadius(r) * 100);
}

export function radiusFromMass(mass: number): number {
  return clampRadius(R0 * (mass / BASE_MASS) ** (1 / 3));
}

/** Момент инерции шара I = 2/5 * m * r² */
export function sphereInertia(mass: number, radius: number): number {
  return (2 / 5) * mass * radius * radius;
}

/** Лёгкое сопротивление; крупные шары чуть дольше держат инерцию */
export function linearDampingForMass(mass: number): number {
  return 0.06 + mass * 0.01;
}

export function angularDampingForMass(mass: number): number {
  return 0.05 + mass * 0.012;
}

/** Потолок линейной скорости растёт с радиусом (катящийся шар крупнее — быстрее). */
export function maxLinearSpeedForRadius(radius: number): number {
  const t = Math.min(1, Math.max(0, (radius - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS)));
  return MAX_LINEAR_SPEED * (0.75 + 0.95 * Math.sqrt(t + 0.05));
}

/** Дистанция камеры: r=0.5 → ~14, r=2 → ~28, r=8 → ~68 */
export function cameraRadiusForPlayer(radius: number): number {
  const r = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
  const zoom = 12 + r * 10 + (r / MAX_RADIUS) ** 2 * 26;
  return Math.max(CAM_RADIUS_MIN, Math.min(CAM_RADIUS_MAX, zoom));
}

/**
 * Горизонтальный импульс разгона (Н·с за кадр, умножается на dt на сервере).
 * Тяжёлый шар разгоняется сильнее, но хуже поворачивает.
 */
export function rollingDriveImpulse(
  radius: number,
  mass: number,
  moveX: number,
  moveZ: number,
  vx = 0,
  vz = 0,
): { x: number; z: number } {
  const len = Math.hypot(moveX, moveZ);
  if (len < 1e-6) return { x: 0, z: 0 };

  const nx = moveX / len;
  const nz = moveZ / len;
  const size = radius / R0;
  const maxSpd = maxLinearSpeedForRadius(radius);
  const speed = Math.hypot(vx, vz);

  let force = 42 * size ** 0.5 * (mass / BASE_MASS) ** 0.18;

  if (speed > maxSpd * 0.65) {
    force *= Math.max(0.12, 1 - (speed - maxSpd * 0.65) / (maxSpd * 0.45));
  }

  if (speed > 0.4) {
    const align = Math.max(0, (nx * vx + nz * vz) / speed);
    const turnMul = align + (1 - align) / (0.35 + size * 0.5);
    force *= Math.max(0.28, Math.min(1, turnMul));
  }

  return { x: nx * force, z: nz * force };
}

/**
 * Крутящий момент для качения.
 * Тяжёлый шар: разгон сохраняется (τ растёт с размером), повороты слабее.
 */
export function rollingDriveTorque(
  radius: number,
  mass: number,
  moveX: number,
  moveZ: number,
  vx = 0,
  vz = 0,
): { x: number; y: number; z: number } {
  const len = Math.hypot(moveX, moveZ);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };

  const size = radius / R0;
  let torque = 1.4 * size ** 0.65 * (mass / BASE_MASS) ** 0.1;

  const nx = moveX / len;
  const nz = moveZ / len;
  return { x: -nz * torque, y: 0, z: nx * torque };
}

/** Торможение: тяжелее — сильнее тормозит, гасит вращение */
export function rollingBrakeTorque(
  mass: number,
  radius: number,
  vx: number,
  vz: number,
  angVel: { x: number; y: number; z: number },
): { linImpulse: { x: number; z: number }; angImpulse: { x: number; y: number; z: number } } {
  const I = sphereInertia(mass, radius);
  const speed = Math.hypot(vx, vz);
  const brakeF = 4.2 * mass;
  const linScale = speed > 0.05 ? brakeF / speed : 0;
  const angScale = 0.12 + (radius / R0) * 0.04;
  return {
    linImpulse: { x: -vx * linScale, z: -vz * linScale },
    angImpulse: {
      x: -angVel.x * I * angScale,
      y: -angVel.y * I * angScale,
      z: -angVel.z * I * angScale,
    },
  };
}

export { GRAVITY };
