import {
  BASE_MASS,
  CAM_RADIUS_MAX,
  CAM_RADIUS_MIN,
  DRIFT_LATERAL_DECAY,
  DRIFT_STEER_ACCEL,
  GRAVITY,
  MAX_LINEAR_SPEED,
  MAX_RADIUS,
  MIN_RADIUS,
  R0,
  SLIDE_FRICTION_DECEL,
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

/**
 * «Заблокированные колёса»: вращение гасится снаружи (angvel → 0),
 * линейная скорость уменьшается только трением скольжения; руль даёт дрифт.
 */
export function applyLockedWheelSlide(
  vx: number,
  vz: number,
  moveX: number,
  moveZ: number,
  dt: number,
): { dvx: number; dvz: number; slipRatio: number } {
  const speed = Math.hypot(vx, vz);
  if (speed < 0.05 || dt <= 0) {
    return { dvx: 0, dvz: 0, slipRatio: 0 };
  }

  const inv = 1 / speed;
  const dirX = vx * inv;
  const dirZ = vz * inv;

  const fricDv = Math.min(speed, SLIDE_FRICTION_DECEL * dt);
  let dvx = -dirX * fricDv;
  let dvz = -dirZ * fricDv;

  const steerLen = Math.hypot(moveX, moveZ);
  let driftBoost = 0;
  if (steerLen > 0.06) {
    const nx = moveX / steerLen;
    const nz = moveZ / steerLen;
    const cross = dirX * nz - dirZ * nx;
    const driftScale = 0.25 + 0.75 * Math.min(1, Math.abs(cross));
    const steerDv = DRIFT_STEER_ACCEL * dt * driftScale;
    dvx += nx * steerDv;
    dvz += nz * steerDv;
    driftBoost = driftScale * 0.35;
  }

  const slipRatio = Math.min(
    1,
    0.55 + driftBoost + Math.min(0.45, fricDv / (speed + 0.01)),
  );
  return { dvx, dvz, slipRatio };
}

/** Сохранить боковую составную при дрифте (низкое сцепление). */
export function applyDriftLateralGrip(
  vx: number,
  vz: number,
  moveX: number,
  moveZ: number,
  dt: number,
): { vx: number; vz: number } {
  const steerLen = Math.hypot(moveX, moveZ);
  if (steerLen < 0.06 || dt <= 0) return { vx, vz };

  const nx = moveX / steerLen;
  const nz = moveZ / steerLen;
  const fwd = vx * nx + vz * nz;
  const latX = vx - nx * fwd;
  const latZ = vz - nz * fwd;
  const retain = Math.exp(-DRIFT_LATERAL_DECAY * dt);
  return {
    vx: nx * fwd + latX * retain,
    vz: nz * fwd + latZ * retain,
  };
}

/** Насколько скорость «скользит» относительно вращения (1 = полный занос). */
export function slideSlipRatio(
  vx: number,
  vz: number,
  angVel: { x: number; y: number; z: number },
  radius: number,
): number {
  const speed = Math.hypot(vx, vz);
  if (speed < 0.4) return 0;
  const spinSpeed = Math.hypot(angVel.x, angVel.z) * radius;
  return Math.min(1, Math.abs(speed - spinSpeed) / speed);
}

export { GRAVITY };
