import {
  ARENA_HALF,
  DEATH_SCATTER_FRACTION,
  EAT_RATIO,
  KILL_ABSORB_FRACTION,
  MIN_RADIUS,
  PELLET_RADIUS,
  RESPAWN_INVULN_MS,
} from "@spherio/shared";
import { massFromRadius } from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PelletManager, type PelletData } from "./PelletManager.js";
import { PlayerState, type ArenaState } from "../schema/ArenaState.js";

export interface EatEvents {
  pelletEaten: { eaterId: string; pelletId: string; newRadius: number }[];
  playerEaten: {
    eaterId: string;
    victimId: string;
    victimOwnerId: string;
    killerName: string;
    victimName: string;
    newRadius: number;
    victimX: number;
    victimZ: number;
    victimRadius: number;
    scatterMass: number;
    removedPartOnly: boolean;
  }[];
  respawns: { playerId: string; ownerId: string; x: number; z: number }[];
}

export class EatResolver {
  resolve(
    physics: PhysicsWorld,
    state: ArenaState,
    pellets: Map<string, PelletData>,
    sessionParts: Map<string, string[]>,
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
            PelletManager.massGainFor(pellet),
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
        if (eater.ownerId === victim.ownerId) continue;
        if ((invuln.get(victim.id) ?? 0) > now) continue;
        if (eater.radius < victim.radius * EAT_RATIO) continue;

        const vPos = victim.body.translation();
        const dx = vPos.x - ePos.x;
        const dz = vPos.z - ePos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < eater.radius + victim.radius * 0.85) {
          const victimMass = massFromRadius(victim.radius);
          const scatterMass = victimMass * DEATH_SCATTER_FRACTION;
          const absorbMass = victimMass * KILL_ABSORB_FRACTION;
          const newRadius = PelletManager.applyMassGain(
            eater.radius,
            absorbMass,
          );

          const ownerId = victim.ownerId;
          const parts = sessionParts.get(ownerId);
          const partList = parts ?? [victim.id];
          const removedPartOnly = partList.length > 1;

          const killerPs = state.players.get(eater.id);
          const victimPs = state.players.get(victim.id);
          const victimName = victimPs?.name ?? victim.id;
          const victimColor = victimPs?.color ?? 0xffffff;
          const victimSkin = victimPs?.skinId ?? "emoji_grin";
          const victimIsBot = victimPs?.isBot ?? false;

          events.playerEaten.push({
            eaterId: eater.id,
            victimId: victim.id,
            victimOwnerId: ownerId,
            killerName: killerPs?.name ?? eater.id,
            victimName,
            newRadius,
            victimX: vPos.x,
            victimZ: vPos.z,
            victimRadius: victim.radius,
            scatterMass,
            removedPartOnly,
          });

          physics.setRadius(eater.id, newRadius);

          if (parts) {
            const partIdx = parts.indexOf(victim.id);
            if (partIdx >= 0) parts.splice(partIdx, 1);
          }

          physics.removePlayer(victim.id);
          state.players.delete(victim.id);
          invuln.delete(victim.id);

          if (removedPartOnly) {
            continue;
          }

          const margin = 3;
          const rx = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
          const rz = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
          const respawnId = ownerId;
          physics.addPlayer(respawnId, MIN_RADIUS, rx, rz, ownerId);
          if (parts) {
            parts.length = 0;
            parts.push(respawnId);
          }

          const row = new PlayerState();
          row.id = respawnId;
          row.name = victimName;
          row.color = victimColor;
          row.skinId = victimSkin;
          row.isBot = victimIsBot;
          row.radius = MIN_RADIUS;
          row.x = rx;
          row.z = rz;
          state.players.set(respawnId, row);

          invuln.set(respawnId, now + RESPAWN_INVULN_MS);
          events.respawns.push({
            playerId: respawnId,
            ownerId,
            x: rx,
            z: rz,
          });
        }
      }
    }

    return events;
  }
}
