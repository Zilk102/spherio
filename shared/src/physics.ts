import {
  BASE_MASS,
  BASE_TORQUE,
  BRAKE_STRENGTH,
  MAX_RADIUS,
  MIN_RADIUS,
  R0,
  TICK_DT,
} from "./constants.js";

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function clampRadius(r: number): number {
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, r));
}

export function massFromRadius(r: number): number {
  return BASE_MASS * (r / R0) ** 3;
}

export function radiusFromMass(mass: number): number {
  return clampRadius(R0 * (mass / BASE_MASS) ** (1 / 3));
}

/** Крупная сфера — слабее разгон (момент ∝ 1/r²) */
export function driveTorqueMagnitude(r: number, inputLen: number): number {
  if (inputLen < 1e-6) return 0;
  const scale = (R0 / r) ** 2;
  return BASE_TORQUE * scale * Math.min(1, inputLen);
}

export function linearDampingForMass(mass: number): number {
  return 0.15 + mass * 0.08;
}

export function angularDampingForMass(mass: number): number {
  return 0.2 + mass * 0.06;
}

/** Импульс против скорости с учётом массы */
export function brakeImpulse(
  mass: number,
  vx: number,
  vz: number,
): { x: number; z: number } {
  return {
    x: -vx * BRAKE_STRENGTH * mass * TICK_DT,
    z: -vz * BRAKE_STRENGTH * mass * TICK_DT,
  };
}

/** Ось вращения для качения по плоскости XZ: cross(up, moveDir) */
export function rollTorqueImpulse(
  r: number,
  moveX: number,
  moveZ: number,
): { x: number; y: number; z: number } {
  const len = Math.hypot(moveX, moveZ);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  const mag = driveTorqueMagnitude(r, len);
  const nx = moveX / len;
  const nz = moveZ / len;
  return {
    x: -nz * mag,
    y: 0,
    z: nx * mag,
  };
}
