import {
  ARENA_HALF,
  BOT_COUNT,
  EAT_RATIO,
} from "@spherio/shared";
import type { InputMessage } from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { PelletManager, type PelletData } from "./PelletManager.js";

interface BotMemory {
  foodId: string;
  foodX: number;
  foodZ: number;
  foodUntil: number;
  roamAngle: number;
  stuckMs: number;
}

export class BotAI {
  private memory = new Map<string, BotMemory>();
  private foodClaims = new Map<string, string>();

  private mem(botId: string): BotMemory {
    let m = this.memory.get(botId);
    if (!m) {
      const slot = parseInt(botId.replace("bot_", ""), 10) || 0;
      m = {
        foodId: "",
        foodX: 0,
        foodZ: 0,
        foodUntil: 0,
        roamAngle: (slot / BOT_COUNT) * Math.PI * 2,
        stuckMs: 0,
      };
      this.memory.set(botId, m);
    }
    return m;
  }

  decide(
    botId: string,
    physics: PhysicsWorld,
    pellets: Map<string, PelletData>,
    now: number,
    invuln: Map<string, number>,
    dtSec: number,
  ): InputMessage {
    const bot = physics.getPlayer(botId);
    if (!bot) return { moveX: 0, moveZ: 0, brake: false };

    this.pruneClaims(now);
    const mem = this.mem(botId);
    const pos = bot.body.translation();
    const vel = bot.body.linvel();
    const speed = Math.hypot(vel.x, vel.z);
    const br = bot.radius;

    let dx = 0;
    let dz = 0;
    let flee = false;
    let nearbyBots = 0;

    const players = physics.getAllPlayers();

    for (const other of players) {
      if (other.id === botId) continue;
      if ((invuln.get(other.id) ?? 0) > now) continue;

      const op = other.body.translation();
      const odx = op.x - pos.x;
      const odz = op.z - pos.z;
      const dist = Math.hypot(odx, odz);
      if (dist < 0.15) continue;

      const nx = odx / dist;
      const nz = odz / dist;
      const isBot = other.id.startsWith("bot_");
      const sepRadius = br + other.radius + (isBot ? 4 : 2);

      if (isBot && dist < 22) nearbyBots++;

      if (dist < sepRadius + 6) {
        const push = ((sepRadius + 6) - dist) / (sepRadius + 6);
        const mul = isBot ? 5.5 : 2.8;
        dx -= nx * push * mul;
        dz -= nz * push * mul;
      }

      if (!isBot && other.radius >= br * EAT_RATIO && dist < other.radius * 3 + 22) {
        const w = 4 / (dist + 0.4);
        dx -= nx * w;
        dz -= nz * w;
        flee = true;
      } else if (
        !flee &&
        br >= other.radius * EAT_RATIO &&
        other.radius < br * 0.9 &&
        dist < 28
      ) {
        const w = 1.5 / (dist + 2);
        dx += nx * w;
        dz += nz * w;
      }
    }

    const distWallX = ARENA_HALF - Math.abs(pos.x);
    const distWallZ = ARENA_HALF - Math.abs(pos.z);
    const cornerDist = Math.min(distWallX, distWallZ);
    if (cornerDist < 16) {
      const cx = -pos.x;
      const cz = -pos.z;
      const cl = Math.hypot(cx, cz) || 1;
      const w = (16 - cornerDist) / 16;
      dx += (cx / cl) * w * 4.5;
      dz += (cz / cl) * w * 4.5;
    }

    if (nearbyBots >= 1) {
      const scatter = mem.roamAngle + (parseInt(botId.replace("bot_", ""), 10) || 0) * 1.7;
      dx += Math.cos(scatter) * 3.5;
      dz += Math.sin(scatter) * 3.5;
      mem.roamAngle += 0.4;
    }

    if (!flee) {
      const food = this.pickFood(botId, pellets, pos, now, mem);
      if (food) {
        const fdx = food.x - pos.x;
        const fdz = food.z - pos.z;
        const fd = Math.hypot(fdx, fdz);
        if (fd > 0.4) {
          const w = 3.2 / (fd + 0.8);
          dx += (fdx / fd) * w;
          dz += (fdz / fd) * w;
        }
      } else {
        mem.roamAngle += dtSec * 0.9;
        dx += Math.cos(mem.roamAngle) * 1.8;
        dz += Math.sin(mem.roamAngle) * 1.8;
      }
    }

    if (speed < 0.5) mem.stuckMs += dtSec * 1000;
    else mem.stuckMs = Math.max(0, mem.stuckMs - dtSec * 400);

    if (mem.stuckMs > 450) {
      mem.stuckMs = 0;
      mem.roamAngle = Math.random() * Math.PI * 2;
      mem.foodUntil = 0;
      this.foodClaims.delete(mem.foodId);
      const cx = -pos.x;
      const cz = -pos.z;
      const cl = Math.hypot(cx, cz) || 1;
      dx += (cx / cl) * 5 + Math.cos(mem.roamAngle) * 2;
      dz += (cz / cl) * 5 + Math.sin(mem.roamAngle) * 2;
    }

    const len = Math.hypot(dx, dz);
    if (len < 0.15) {
      dx += Math.cos(mem.roamAngle);
      dz += Math.sin(mem.roamAngle);
    }

    const outLen = Math.hypot(dx, dz);
    if (outLen < 1e-4) return { moveX: 0, moveZ: 0, brake: false };

    return {
      moveX: dx / outLen,
      moveZ: dz / outLen,
      brake: flee && speed > 3 && Math.random() < 0.06,
    };
  }

  private pruneClaims(now: number): void {
    for (const [id, m] of this.memory) {
      if (m.foodUntil < now && m.foodId) {
        this.foodClaims.delete(m.foodId);
      }
    }
  }

  private pickFood(
    botId: string,
    pellets: Map<string, PelletData>,
    pos: { x: number; z: number },
    now: number,
    mem: BotMemory,
  ): PelletData | null {
    if (mem.foodId && mem.foodUntil > now) {
      const kept = pellets.get(mem.foodId);
      if (kept) return kept;
    }

    let best: PelletData | null = null;
    let bestScore = -1;

    for (const pellet of pellets.values()) {
      const owner = this.foodClaims.get(pellet.id);
      if (owner && owner !== botId) continue;

      const pdx = pellet.x - pos.x;
      const pdz = pellet.z - pos.z;
      const dist = Math.hypot(pdx, pdz);
      if (dist > 65) continue;

      const gain = PelletManager.massGainFor(pellet);
      const score = gain / (dist + 1.5);
      if (score > bestScore) {
        bestScore = score;
        best = pellet;
      }
    }

    if (best) {
      if (mem.foodId && mem.foodId !== best.id) {
        this.foodClaims.delete(mem.foodId);
      }
      mem.foodId = best.id;
      mem.foodX = best.x;
      mem.foodZ = best.z;
      mem.foodUntil = now + 2000 + Math.random() * 1500;
      this.foodClaims.set(best.id, botId);
    }

    return best;
  }
}
