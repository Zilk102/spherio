import {
  SPLIT_MERGE_CONTACT_MS,
  SPLIT_REJOIN_PULL_ACCEL,
} from "@spherio/shared";
import { radiusFromMass } from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import type { ArenaState } from "../schema/ArenaState.js";

/** Тянет каждую часть к центру остальных частей той же сессии. */
export function applySplitRejoinPull(
  physics: PhysicsWorld,
  sessionParts: Map<string, string[]>,
  dt: number,
): void {
  for (const parts of sessionParts.values()) {
    if (parts.length < 2) continue;

    const bodies = parts
      .map((id) => physics.getPlayer(id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (bodies.length < 2) continue;

    for (const part of bodies) {
      const pos = part.body.translation();
      let cx = 0;
      let cz = 0;
      let n = 0;
      for (const other of bodies) {
        if (other.id === part.id) continue;
        const o = other.body.translation();
        cx += o.x;
        cz += o.z;
        n++;
      }
      if (n === 0) continue;
      cx /= n;
      cz /= n;

      let dx = cx - pos.x;
      let dz = cz - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) continue;
      dx /= dist;
      dz /= dist;

      const ramp = Math.min(1, dist / 3.2);
      const accel = SPLIT_REJOIN_PULL_ACCEL * (0.55 + 0.45 * ramp);
      part.body.applyImpulse(
        { x: dx * accel * part.mass * dt, y: 0, z: dz * accel * part.mass * dt },
        true,
      );
    }
  }
}

export interface SplitMergeEvent {
  sessionId: string;
  keepId: string;
  removedId: string;
  newRadius: number;
}

function contactPairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

export function clearSplitContactForPart(
  contactSince: Map<string, number>,
  partId: string,
): void {
  for (const key of contactSince.keys()) {
    const [a, b] = key.split("|");
    if (a === partId || b === partId) contactSince.delete(key);
  }
}

/** Сливает две части одной сессии после непрерывного соприкосновения. */
export function resolveSplitMerges(
  physics: PhysicsWorld,
  state: ArenaState,
  sessionParts: Map<string, string[]>,
  contactSince: Map<string, number>,
  now: number,
): SplitMergeEvent[] {
  const events: SplitMergeEvent[] = [];
  const activePairs = new Set<string>();

  for (const [sessionId, parts] of sessionParts) {
    if (parts.length < 2) continue;

    let mergedThisTick = false;
    for (let i = 0; i < parts.length && !mergedThisTick; i++) {
      for (let j = i + 1; j < parts.length && !mergedThisTick; j++) {
        const idA = parts[i]!;
        const idB = parts[j]!;
        const a = physics.getPlayer(idA);
        const b = physics.getPlayer(idB);
        if (!a || !b) continue;

        const pa = a.body.translation();
        const pb = b.body.translation();
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const dist = Math.hypot(dx, dz);
        const touch = a.radius + b.radius;
        const pairKey = contactPairKey(idA, idB);
        if (dist > touch) continue;

        activePairs.add(pairKey);
        const since = contactSince.get(pairKey);
        if (since === undefined) {
          contactSince.set(pairKey, now);
          continue;
        }
        if (now - since < SPLIT_MERGE_CONTACT_MS) continue;

        const keep = a.mass >= b.mass ? a : b;
        const drop = a.mass >= b.mass ? b : a;
        const newRadius = radiusFromMass(keep.mass + drop.mass);

        const wx = (pa.x * a.mass + pb.x * b.mass) / (a.mass + b.mass);
        const wz = (pa.z * a.mass + pb.z * b.mass) / (a.mass + b.mass);

        physics.teleport(keep.id, wx, wz, newRadius);
        physics.removePlayer(drop.id);
        state.players.delete(drop.id);

        const dropIdx = parts.indexOf(drop.id);
        if (dropIdx >= 0) parts.splice(dropIdx, 1);

        const ps = state.players.get(keep.id);
        if (ps) ps.radius = newRadius;

        contactSince.delete(pairKey);
        clearSplitContactForPart(contactSince, drop.id);

        events.push({
          sessionId,
          keepId: keep.id,
          removedId: drop.id,
          newRadius,
        });
        mergedThisTick = true;
      }
    }
  }

  for (const key of contactSince.keys()) {
    if (!activePairs.has(key)) contactSince.delete(key);
  }

  return events;
}
