import {
  ARENA_HALF,
  EAT_RATIO,
  MIN_RADIUS,
  PELLET_RADIUS,
  RESPAWN_INVULN_MS,
} from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PelletManager, type PelletData } from "./PelletManager.js";

export interface EatEvents {
  pelletEaten: { eaterId: string; pelletId: string; newRadius: number }[];
  playerEaten: { eaterId: string; victimId: string; newRadius: number }[];
  respawns: { playerId: string; x: number; z: number }[];
}

export class EatResolver {
  resolve(
    physics: PhysicsWorld,
    pellets: Map<string, PelletData>,
    now: number,
    invuln: Map<string, number>,
  ): EatEvents {
    const events: EatEvents = {
      pelletEaten: [],
      playerEaten: [],
      respawns: [],
    };

    const players = physics.getAllPlayers();

    for (const eater of players) {
      if ((invuln.get(eater.id) ?? 0) > now) continue;
      const pos = eater.body.translation();
      let er = eater.radius;

      for (const [pid, pellet] of [...pellets.entries()]) {
        const dx = pellet.x - pos.x;
        const dz = pellet.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < er + PELLET_RADIUS) {
          const newRadius = PelletManager.applyMassGain(
            er,
            PelletManager.pelletMassGain(),
          );
          events.pelletEaten.push({
            eaterId: eater.id,
            pelletId: pid,
            newRadius,
          });
          physics.setRadius(eater.id, newRadius);
          eater.radius = newRadius;
          er = newRadius;
          pellets.delete(pid);
        }
      }
    }

    for (const eater of players) {
      if ((invuln.get(eater.id) ?? 0) > now) continue;
      const ePos = eater.body.translation();

      for (const victim of players) {
        if (eater.id === victim.id) continue;
        if ((invuln.get(victim.id) ?? 0) > now) continue;
        if (eater.radius < victim.radius * EAT_RATIO) continue;

        const vPos = victim.body.translation();
        const dx = vPos.x - ePos.x;
        const dz = vPos.z - ePos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < eater.radius + victim.radius * 0.85) {
          const newRadius = PelletManager.applyMassGain(
            eater.radius,
            massFromVictim(victim.radius),
          );
          events.playerEaten.push({
            eaterId: eater.id,
            victimId: victim.id,
            newRadius,
          });
          physics.setRadius(eater.id, newRadius);

          const margin = 3;
          const rx = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
          const rz = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
          physics.teleport(victim.id, rx, rz, MIN_RADIUS);
          invuln.set(victim.id, now + RESPAWN_INVULN_MS);
          events.respawns.push({ playerId: victim.id, x: rx, z: rz });
        }
      }
    }

    return events;
  }
}

function massFromVictim(radius: number): number {
  return (radius ** 3) * 0.08;
}
