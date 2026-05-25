import { BOOST_MAX_SPEED_FACTOR, MAX_ANGULAR_SPEED } from "@spherio/shared";
import { maxLinearSpeedForRadius } from "@spherio/shared";
import type { PlayerBody } from "./PhysicsWorld.js";

/** Дополнительные проверки после шага физики */
export function enforceSpeedLimits(players: PlayerBody[]): void {
  for (const p of players) {
    const boostCap = p.input.boost ? BOOST_MAX_SPEED_FACTOR : 1;
    const maxLin = maxLinearSpeedForRadius(p.radius) * boostCap * 1.05;
    const lv = p.body.linvel();
    const ls = Math.hypot(lv.x, lv.y, lv.z);
    if (ls > maxLin) {
      const s = maxLin / ls;
      p.body.setLinvel({ x: lv.x * s, y: lv.y * s, z: lv.z * s }, true);
    }
    const av = p.body.angvel();
    const as = Math.hypot(av.x, av.y, av.z);
    if (as > MAX_ANGULAR_SPEED * 1.05) {
      const s = MAX_ANGULAR_SPEED / as;
      p.body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
    }
  }
}
