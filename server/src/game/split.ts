import {
  GROUND_Y,
  MAX_SPLIT_PARTS,
  MIN_RADIUS,
  SPLIT_CHILD_MASS_RATIO,
  SPLIT_COOLDOWN_MS,
  SPLIT_LAUNCH_IMPULSE,
  SPLIT_MIN_RADIUS,
} from "@spherio/shared";
import { massFromRadius, radiusFromMass } from "@spherio/shared";
import type { SplitMessage } from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PlayerState, type ArenaState } from "../schema/ArenaState.js";

export interface SplitContext {
  physics: PhysicsWorld;
  state: ArenaState;
  sessionParts: Map<string, string[]>;
  splitCooldownUntil: Map<string, number>;
  invuln: Map<string, number>;
}

export type SplitResult =
  | { ok: true; parentId: string; childId: string }
  | { ok: false; reason: string };

/** Выбрать крупнейшую часть сессии для деления. */
function largestPartId(physics: PhysicsWorld, parts: string[]): string | null {
  let best: string | null = null;
  let bestR = -1;
  for (const id of parts) {
    const p = physics.getPlayer(id);
    if (!p) continue;
    if (p.radius > bestR) {
      bestR = p.radius;
      best = id;
    }
  }
  return best;
}

function nextChildId(sessionId: string, parts: string[]): string {
  let maxIdx = 0;
  for (const id of parts) {
    if (!id.startsWith(`${sessionId}~`)) continue;
    const suffix = id.slice(sessionId.length + 1);
    const n = parseInt(suffix, 10);
    if (Number.isFinite(n) && n > maxIdx) maxIdx = n;
  }
  return `${sessionId}~${maxIdx + 1}`;
}

function aimDir(
  physics: PhysicsWorld,
  partId: string,
  msg: SplitMessage,
): { x: number; z: number } {
  const p = physics.getPlayer(partId);
  if (!p) return { x: 0, z: 1 };
  let mx = Number(msg.moveX);
  let mz = Number(msg.moveZ);
  if (!Number.isFinite(mx) || !Number.isFinite(mz)) {
    mx = p.input.moveX;
    mz = p.input.moveZ;
  }
  let len = Math.hypot(mx, mz);
  if (len < 0.08) {
    const v = p.body.linvel();
    mx = v.x;
    mz = v.z;
    len = Math.hypot(mx, mz);
  }
  if (len < 0.08) return { x: 0, z: 1 };
  return { x: mx / len, z: mz / len };
}

export function trySplit(
  ctx: SplitContext,
  sessionId: string,
  playerMeta: { name: string; color: number; skinId: string },
  msg: SplitMessage,
  now: number,
): SplitResult {
  const parts = ctx.sessionParts.get(sessionId);
  if (!parts || parts.length === 0) {
    return { ok: false, reason: "no_parts" };
  }
  if (parts.length >= MAX_SPLIT_PARTS) {
    return { ok: false, reason: "max_parts" };
  }
  const cooldown = ctx.splitCooldownUntil.get(sessionId) ?? 0;
  if (now < cooldown) {
    return { ok: false, reason: "cooldown" };
  }

  const parentId = largestPartId(ctx.physics, parts);
  if (!parentId) return { ok: false, reason: "no_body" };

  const parent = ctx.physics.getPlayer(parentId);
  if (!parent) return { ok: false, reason: "no_body" };
  if (parent.radius < SPLIT_MIN_RADIUS) {
    return { ok: false, reason: "too_small" };
  }

  const childMass = parent.mass * SPLIT_CHILD_MASS_RATIO;
  const parentMass = parent.mass - childMass;
  const childR = radiusFromMass(childMass);
  const parentR = radiusFromMass(parentMass);

  if (childR < MIN_RADIUS || parentR < MIN_RADIUS) {
    return { ok: false, reason: "too_small" };
  }

  const dir = aimDir(ctx.physics, parentId, msg);
  const pos = parent.body.translation();
  const offset = parentR + childR + 0.35;
  const childX = pos.x + dir.x * offset;
  const childZ = pos.z + dir.z * offset;

  const childId = nextChildId(sessionId, parts);

  ctx.physics.setRadius(parentId, parentR);
  const childBody = ctx.physics.addPlayer(childId, childR, childX, childZ, sessionId);
  childBody.input = { ...parent.input };

  const launch = SPLIT_LAUNCH_IMPULSE * childBody.mass;
  childBody.body.applyImpulse(
    { x: dir.x * launch, y: 0, z: dir.z * launch },
    true,
  );
  parent.body.applyImpulse(
    { x: -dir.x * launch * 0.35, y: 0, z: -dir.z * launch * 0.35 },
    true,
  );

  const ps = ctx.state.players.get(parentId);
  const row = new PlayerState();
  row.id = childId;
  row.name = ps?.name ?? playerMeta.name;
  row.color = ps?.color ?? playerMeta.color;
  row.skinId = ps?.skinId ?? playerMeta.skinId;
  row.radius = childR;
  row.isBot = false;
  row.x = childX;
  row.y = GROUND_Y + childR + 0.02;
  row.z = childZ;
  ctx.state.players.set(childId, row);

  parts.push(childId);
  ctx.splitCooldownUntil.set(sessionId, now + SPLIT_COOLDOWN_MS);

  return { ok: true, parentId, childId };
}
