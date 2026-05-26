import {
  ARENA_HALF,
  BOOST_MASS_DRAIN_PER_SEC,
  BOOST_SPEED_MULTIPLIER,
  GROUND_Y,
  MAX_ANGULAR_SPEED,
  MIN_RADIUS,
} from "./constants.js";
import type { InputMessage } from "./messages.js";
import {
  applyDriftLateralGrip,
  applyLockedWheelSlide,
  clampRadius,
  linearDampingForMass,
  massFromRadius,
  maxLinearSpeedForRadius,
  radiusFromMass,
  rollingDriveImpulse,
  rollingDriveTorque,
} from "./physics.js";

/** Состояние сферы для клиентского предсказания (без Rapier). */
export interface KinematicBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Угловая скорость (рад/с) — для визуального кватерниона на клиенте. */
  avx: number;
  avy: number;
  avz: number;
  radius: number;
  mass: number;
}

export function kinematicBodyFromSnap(
  x: number,
  y: number,
  z: number,
  vx: number,
  vz: number,
  radius: number,
): KinematicBody {
  const r = clampRadius(radius);
  return {
    x,
    y: y || GROUND_Y + r + 0.02,
    z,
    vx,
    vy: 0,
    vz,
    avx: 0,
    avy: 0,
    avz: 0,
    radius: r,
    mass: massFromRadius(r),
  };
}

/**
 * Один шаг кинематической симуляции — те же импульсы, что в PhysicsWorld.step,
 * но без Rapier (интеграция Эйлера + clamp стен арены).
 */
export function kinematicStep(body: KinematicBody, input: InputMessage, dt: number): void {
  if (dt <= 0) return;

  const { moveX, moveZ, brake, boost } = input;
  const len = Math.hypot(moveX, moveZ);
  const braking = !!brake;
  const moving = len > 0.06 && !braking;
  const boosting = !!boost && moving;
  const boostMul = boosting ? BOOST_SPEED_MULTIPLIER : 1;

  if (moving) {
    const nx = moveX / len;
    const nz = moveZ / len;
    const impulse = rollingDriveImpulse(
      body.radius,
      body.mass,
      nx,
      nz,
      body.vx,
      body.vz,
    );
    const torque = rollingDriveTorque(
      body.radius,
      body.mass,
      nx,
      nz,
      body.vx,
      body.vz,
    );
    body.vx += impulse.x * dt * boostMul;
    body.vz += impulse.z * dt * boostMul;
    body.avx += torque.x * dt * boostMul;
    body.avy += torque.y * dt * boostMul;
    body.avz += torque.z * dt * boostMul;
    if (boosting) {
      const burst = 1.1 * body.mass;
      body.vx += nx * burst * dt;
      body.vz += nz * burst * dt;
    }
  }

  if (brake) {
    body.avx = 0;
    body.avy = 0;
    body.avz = 0;
    const slide = applyLockedWheelSlide(body.vx, body.vz, moveX, moveZ, dt);
    body.vx += slide.dvx;
    body.vz += slide.dvz;
    const gripped = applyDriftLateralGrip(body.vx, body.vz, moveX, moveZ, dt);
    body.vx = gripped.vx;
    body.vz = gripped.vz;
  }

  if (boosting && moving) {
    const drain = BOOST_MASS_DRAIN_PER_SEC * dt;
    const newMass = Math.max(massFromRadius(MIN_RADIUS), body.mass - drain);
    const newR = radiusFromMass(newMass);
    if (Math.abs(newR - body.radius) > 1e-5) {
      body.mass = newMass;
      body.radius = newR;
    }
  }

  // Линейное затухание Rapier; при скольжении только трение slide выше.
  if (!braking) {
    const linDamp = Math.exp(-linearDampingForMass(body.mass) * dt);
    body.vx *= linDamp;
    body.vz *= linDamp;
  }

  body.x += body.vx * dt;
  body.z += body.vz * dt;

  const r = body.radius;
  body.y = GROUND_Y + r + 0.02;

  const margin = ARENA_HALF - r - 0.5;
  if (body.x > margin) {
    body.x = margin;
    body.vx = Math.min(body.vx, 0);
  } else if (body.x < -margin) {
    body.x = -margin;
    body.vx = Math.max(body.vx, 0);
  }
  if (body.z > margin) {
    body.z = margin;
    body.vz = Math.min(body.vz, 0);
  } else if (body.z < -margin) {
    body.z = -margin;
    body.vz = Math.max(body.vz, 0);
  }

  clampKinematicVelocity(body);
}

function clampKinematicVelocity(body: KinematicBody): void {
  const maxLin = maxLinearSpeedForRadius(body.radius);
  const ls = Math.hypot(body.vx, body.vz);
  if (ls > maxLin) {
    const s = maxLin / ls;
    body.vx *= s;
    body.vz *= s;
  }
  const as = Math.hypot(body.avx, body.avy, body.avz);
  if (as > MAX_ANGULAR_SPEED) {
    const s = MAX_ANGULAR_SPEED / as;
    body.avx *= s;
    body.avy *= s;
    body.avz *= s;
  }
}

/** Согласование с авторитетным снапшотом сервера (мягко или жёстко). */
export function reconcileKinematic(
  body: KinematicBody,
  sx: number,
  sy: number,
  sz: number,
  svx: number,
  svz: number,
  sr: number,
  blend: number,
): void {
  const t = Math.max(0, Math.min(1, blend));
  body.x += (sx - body.x) * t;
  body.y += (sy - body.y) * t;
  body.z += (sz - body.z) * t;
  body.vx += (svx - body.vx) * t;
  body.vz += (svz - body.vz) * t;
  const r = clampRadius(sr);
  if (Math.abs(r - body.radius) > 1e-4) {
    body.radius = r;
    body.mass = massFromRadius(r);
  }
}

/** Интеграция угловой скорости в кватернион (малый угол за кадр). */
export function spinQuaternion(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  avx: number,
  avy: number,
  avz: number,
  dt: number,
): { qx: number; qy: number; qz: number; qw: number } {
  const hx = avx * dt * 0.5;
  const hy = avy * dt * 0.5;
  const hz = avz * dt * 0.5;
  const nx = qw * hx + qy * hz - qz * hy;
  const ny = qw * hy + qz * hx - qx * hz;
  const nz = qw * hz + qx * hy - qy * hx;
  const nw = -qx * hx - qy * hy - qz * hz;
  const len = Math.hypot(nx, ny, nz, nw) || 1;
  return {
    qx: nx / len,
    qy: ny / len,
    qz: nz / len,
    qw: nw / len,
  };
}
