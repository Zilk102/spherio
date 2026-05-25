import { BOOST_MASS_DRAIN_PER_SEC, MIN_RADIUS } from "@spherio/shared";
import { massFromRadius, radiusFromMass } from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { ArenaState, KillFeedEntryState } from "../schema/ArenaState.js";

export const KILL_FEED_MAX = 8;

export function handleBoost(
  physics: PhysicsWorld,
  sessionParts: Map<string, string[]>,
  sessionId: string,
  active: boolean,
): void {
  const parts = sessionParts.get(sessionId);
  if (!parts) return;
  for (const partId of parts) {
    const p = physics.getPlayer(partId);
    if (!p) continue;
    p.input = { ...p.input, boost: active };
  }
}

export function applyBoostMassDrain(
  physics: PhysicsWorld,
  sessionParts: Map<string, string[]>,
  dt: number,
): void {
  if (dt <= 0) return;
  const drain = BOOST_MASS_DRAIN_PER_SEC * dt;
  for (const parts of sessionParts.values()) {
    for (const partId of parts) {
      const p = physics.getPlayer(partId);
      if (!p?.input.boost) continue;
      const moving = Math.hypot(p.input.moveX, p.input.moveZ) > 0.06;
      if (!moving) continue;
      const newMass = Math.max(massFromRadius(MIN_RADIUS), p.mass - drain);
      const newR = radiusFromMass(newMass);
      if (Math.abs(newR - p.radius) > 1e-5) {
        physics.setRadius(partId, newR);
      }
    }
  }
}

export function pushKillFeed(
  state: ArenaState,
  killerName: string,
  victimName: string,
  at: number,
): void {
  const row = new KillFeedEntryState();
  row.killerName = killerName;
  row.victimName = victimName;
  row.at = at;
  state.killFeed.push(row);
  while (state.killFeed.length > KILL_FEED_MAX) {
    state.killFeed.shift();
  }
}
