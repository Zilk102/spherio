import { BOOST_MASS_DRAIN_PER_SEC, MIN_RADIUS } from "@spherio/shared";
import { massFromRadius, radiusFromMass } from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";

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
