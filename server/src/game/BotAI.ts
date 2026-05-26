import {
  ARENA_HALF,
  BOOST_MASS_DRAIN_PER_SEC,
  BOT_COUNT,
  EAT_RATIO,
  MAX_LINEAR_SPEED,
} from "@spherio/shared";
import type { InputMessage } from "@spherio/shared";
import type { PhysicsWorld, PlayerBody } from "./PhysicsWorld.js";
import { PelletManager, type PelletData } from "./PelletManager.js";
import type { HedgehogData } from "./HedgehogManager.js";

/** Лукап цели бота из ArenaState. Возвращает id и radius цели, либо null. */
export type TargetLookup = (botId: string) => { id: string; radius: number } | null;

/**
 * Характеры ботов. Каждый влияет на пороги для атаки/побега, на охотничью настойчивость,
 * долю времени boost и реакцию на push-возможности.
 */
export type BotPersonality = "aggressive" | "cautious" | "balanced" | "hunter";

interface PersonalityTuning {
  /** Множитель «опасной» дистанции от больших игроков (больше → раньше убегает). */
  fleeDistMul: number;
  /** Множитель «охотничьей» дистанции к меньшим (больше → активнее догоняет). */
  chaseDistMul: number;
  /** Базовая склонность тратить boost. 0..1. */
  boostAppetite: number;
  /** Базовая склонность тормозить на манёврах. 0..1. */
  brakeTendency: number;
  /** Готовность таранить +- равных (для push-в-стену). */
  pushAppetite: number;
  /** Минимальный запас массы (после которого boost не используется). */
  boostMassFloor: number;
}

const TUNING: Record<BotPersonality, PersonalityTuning> = {
  aggressive: {
    fleeDistMul: 0.9,
    chaseDistMul: 1.4,
    boostAppetite: 0.85,
    brakeTendency: 0.15,
    pushAppetite: 0.85,
    boostMassFloor: 1.6,
  },
  cautious: {
    fleeDistMul: 1.5,
    chaseDistMul: 0.85,
    boostAppetite: 0.35,
    brakeTendency: 0.55,
    pushAppetite: 0.2,
    boostMassFloor: 3.2,
  },
  hunter: {
    fleeDistMul: 1.0,
    chaseDistMul: 1.7,
    boostAppetite: 0.7,
    brakeTendency: 0.25,
    pushAppetite: 0.55,
    boostMassFloor: 2.0,
  },
  balanced: {
    fleeDistMul: 1.1,
    chaseDistMul: 1.05,
    boostAppetite: 0.55,
    brakeTendency: 0.35,
    pushAppetite: 0.45,
    boostMassFloor: 2.2,
  },
};

interface BotMemory {
  personality: BotPersonality;
  tuning: PersonalityTuning;
  foodId: string;
  foodX: number;
  foodZ: number;
  foodUntil: number;
  roamAngle: number;
  stuckMs: number;
  /** id игрока, которого бот сейчас «преследует» (стабильная цель на несколько секунд). */
  targetId: string;
  targetUntil: number;
  /** Когда бот в последний раз использовал boost — для cooldown. */
  lastBoostMs: number;
  /** Когда последний раз ставил brake. */
  lastBrakeMs: number;
}

const PERSONALITY_DISTRIBUTION: BotPersonality[] = [
  "aggressive",
  "aggressive",
  "balanced",
  "balanced",
  "balanced",
  "cautious",
  "hunter",
  "hunter",
];

export class BotAI {
  private memory = new Map<string, BotMemory>();
  private foodClaims = new Map<string, string>();

  /** Вызывается из ArenaRoom при спавне бота — гарантирует личность. */
  registerBot(botId: string, slot: number, personality?: BotPersonality): void {
    const chosen =
      personality ??
      PERSONALITY_DISTRIBUTION[slot % PERSONALITY_DISTRIBUTION.length] ??
      "balanced";
    this.memory.set(botId, {
      personality: chosen,
      tuning: TUNING[chosen],
      foodId: "",
      foodX: 0,
      foodZ: 0,
      foodUntil: 0,
      roamAngle: (slot / BOT_COUNT) * Math.PI * 2,
      stuckMs: 0,
      targetId: "",
      targetUntil: 0,
      lastBoostMs: 0,
      lastBrakeMs: 0,
    });
  }

  forget(botId: string): void {
    const m = this.memory.get(botId);
    if (m?.foodId) this.foodClaims.delete(m.foodId);
    this.memory.delete(botId);
  }

  private mem(botId: string): BotMemory {
    let m = this.memory.get(botId);
    if (!m) {
      const slot = parseInt(botId.replace("bot_", ""), 10) || 0;
      this.registerBot(botId, slot);
      m = this.memory.get(botId)!;
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
    getTarget?: TargetLookup,
    hedgehogs: HedgehogData[] = [],
  ): InputMessage {
    const bot = physics.getPlayer(botId);
    if (!bot) return { moveX: 0, moveZ: 0, brake: false };

    this.pruneClaims(now);
    const mem = this.mem(botId);
    const tuning = mem.tuning;
    const pos = bot.body.translation();
    const vel = bot.body.linvel();
    const speed = Math.hypot(vel.x, vel.z);
    const br = bot.radius;
    const myMass = bot.mass;

    // Шаг 1: «сканируем» окружение и находим самого опасного хищника и самую вкусную жертву.
    const players = physics.getAllPlayers();
    let threat: { p: PlayerBody; dist: number; nx: number; nz: number } | null = null;
    let prey: { p: PlayerBody; dist: number; nx: number; nz: number } | null = null;
    let nearbyBots = 0;
    let sepX = 0;
    let sepZ = 0;

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

      // Separation: чтобы не залипали друг в друга.
      if (dist < sepRadius + 6) {
        const push = ((sepRadius + 6) - dist) / (sepRadius + 6);
        const mul = isBot ? 5.5 : 2.6;
        sepX -= nx * push * mul;
        sepZ -= nz * push * mul;
      }

      // Угроза: тот, кто реально может нас съесть, в пределах опасной зоны.
      if (other.radius >= br * EAT_RATIO) {
        const dangerRange =
          (other.radius * 3 + 22) * tuning.fleeDistMul * (isBot ? 0.85 : 1.0);
        if (dist < dangerRange) {
          if (!threat || dist < threat.dist) {
            threat = { p: other, dist, nx, nz };
          }
        }
      }

      // Жертва: которую мы можем съесть.
      if (br >= other.radius * EAT_RATIO && other.radius < br * 0.95) {
        const hungerRange = (br * 2 + 30) * tuning.chaseDistMul;
        if (dist < hungerRange) {
          // Чем толще жертва — тем приоритетнее, чем дальше — тем хуже.
          const value = (other.radius * other.radius) / (dist + 2);
          const currentValue = prey
            ? (prey.p.radius * prey.p.radius) / (prey.dist + 2)
            : -1;
          if (value > currentValue) {
            prey = { p: other, dist, nx, nz };
          }
        }
      }
    }

    let dx = sepX;
    let dz = sepZ;
    let boost = false;
    let brakeOverride = false;
    let chasing = false;

    // Если есть назначенная цель — превращаем её в prey, когда она съедобна.
    const assigned = getTarget?.(botId) ?? null;
    let targetPrey: { p: PlayerBody; dist: number; nx: number; nz: number } | null = null;
    if (assigned && assigned.id !== botId) {
      const t = physics.getPlayer(assigned.id);
      if (t && (invuln.get(t.id) ?? 0) <= now) {
        const tp = t.body.translation();
        const tdx = tp.x - pos.x;
        const tdz = tp.z - pos.z;
        const td = Math.hypot(tdx, tdz);
        if (td >= 0.15) {
          // Цель явно крупнее (>= EAT_RATIO) — не лезем в неё, лучше дождаться смены / подрасти.
          if (br >= t.radius * EAT_RATIO * 0.95) {
            targetPrey = {
              p: t,
              dist: td,
              nx: tdx / td,
              nz: tdz / td,
            };
          }
        }
      }
    }

    if (threat) {
      // FLEE: убегаем от хищника по противоположному направлению + чуть в сторону, чтобы не загнал в угол.
      const tangentX = -threat.nz;
      const tangentZ = threat.nx;
      const tangentSign =
        (pos.x * tangentX + pos.z * tangentZ) < 0 ? 1 : -1;
      const dangerProx =
        1 -
        Math.min(
          1,
          threat.dist / ((threat.p.radius * 3 + 22) * tuning.fleeDistMul),
        );
      const fleeW = 4 + 3 * dangerProx;
      dx -= threat.nx * fleeW;
      dz -= threat.nz * fleeW;
      dx += tangentX * tangentSign * (1.5 + dangerProx * 1.5);
      dz += tangentZ * tangentSign * (1.5 + dangerProx * 1.5);

      // Boost при критической близости и если ещё есть запас массы.
      const critical = threat.dist < threat.p.radius * 2 + 6;
      if (critical && myMass > tuning.boostMassFloor && now - mem.lastBoostMs > 1500) {
        if (Math.random() < tuning.boostAppetite) {
          boost = true;
          mem.lastBoostMs = now;
        }
      }
      // Сбросить таргет — сначала спастись.
      mem.targetId = "";
      mem.targetUntil = 0;
    } else if (targetPrey || prey) {
      // Приоритет — назначенная цель (если съедобна). Иначе обычная prey.
      const chase = targetPrey ?? prey!;
      const isAssignedTarget = !!targetPrey;
      if (mem.targetId !== chase.p.id || mem.targetUntil < now) {
        mem.targetId = chase.p.id;
        mem.targetUntil = now + 2000 + Math.random() * 1500;
      }
      const chaseW = isAssignedTarget ? 4.5 : 3.5;
      dx += chase.nx * chaseW;
      dz += chase.nz * chaseW;
      chasing = true;

      // Boost — рывок если жертва на оптимальной дистанции и мы догоняем медленно.
      const vPx = chase.p.body.linvel().x;
      const vPz = chase.p.body.linvel().z;
      const relV = ((vel.x - vPx) * chase.nx + (vel.z - vPz) * chase.nz);
      const inJumpRange = chase.dist > br * 2 + 3 && chase.dist < br * 6 + 22;
      const willCatch = relV > 0.5;
      const appetite = isAssignedTarget
        ? Math.min(1, tuning.boostAppetite + 0.25)
        : tuning.boostAppetite;
      if (
        inJumpRange &&
        !willCatch &&
        myMass > tuning.boostMassFloor &&
        now - mem.lastBoostMs > 1100
      ) {
        if (Math.random() < appetite) {
          boost = true;
          mem.lastBoostMs = now;
        }
      }
    } else {
      // PUSH: если есть бот примерно равной массы рядом — попробуем толкнуть к ближайшей стене.
      let pushTarget: { p: PlayerBody; dist: number; nx: number; nz: number } | null = null;
      for (const other of players) {
        if (other.id === botId) continue;
        if (!other.id.startsWith("bot_")) continue;
        if ((invuln.get(other.id) ?? 0) > now) continue;
        const op = other.body.translation();
        const odx = op.x - pos.x;
        const odz = op.z - pos.z;
        const d = Math.hypot(odx, odz);
        if (d < 0.2 || d > 14 + br * 1.5) continue;
        const rRatio = other.radius / br;
        if (rRatio < 0.85 || rRatio > 1.1) continue;
        // выбираем самого близкого «равного»
        if (!pushTarget || d < pushTarget.dist) {
          pushTarget = { p: other, dist: d, nx: odx / d, nz: odz / d };
        }
      }
      if (pushTarget && Math.random() < tuning.pushAppetite * 0.3) {
        const pushW = 2.0;
        dx += pushTarget.nx * pushW;
        dz += pushTarget.nz * pushW;
      }

      // FORAGE: пеллеты + roam.
      const food = this.pickFood(botId, pellets, pos, now, mem);
      if (food) {
        const fdx = food.x - pos.x;
        const fdz = food.z - pos.z;
        const fd = Math.hypot(fdx, fdz);
        if (fd > 0.4) {
          const w = 3.0 / (fd + 0.8);
          dx += (fdx / fd) * w;
          dz += (fdz / fd) * w;
        }
      } else {
        mem.roamAngle += dtSec * 0.9;
        dx += Math.cos(mem.roamAngle) * 1.8;
        dz += Math.sin(mem.roamAngle) * 1.8;
      }
    }

    // Avoid walls.
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

    if (nearbyBots >= 2) {
      const scatter = mem.roamAngle + (parseInt(botId.replace("bot_", ""), 10) || 0) * 1.7;
      dx += Math.cos(scatter) * 3.5;
      dz += Math.sin(scatter) * 3.5;
      mem.roamAngle += 0.4;
    }

    // Anti-stuck.
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

    // Ёжи-шары: уклоняемся заранее.
    for (const h of hedgehogs) {
      const hdx = h.x - pos.x;
      const hdz = h.z - pos.z;
      const hd = Math.hypot(hdx, hdz);
      const avoidR = h.radius + br + 10;
      if (hd < avoidR && hd > 0.05) {
        const prox = 1 - hd / avoidR;
        const fleeW = 7 + prox * 9;
        dx -= (hdx / hd) * fleeW;
        dz -= (hdz / hd) * fleeW;
        if (hd < h.radius + br + 3 && myMass > tuning.boostMassFloor) {
          if (Math.random() < tuning.boostAppetite * 0.85 && now - mem.lastBoostMs > 900) {
            boost = true;
            mem.lastBoostMs = now;
          }
        }
        if (hd < h.radius + br + 5) {
          brakeOverride = true;
        }
        mem.targetId = "";
        mem.targetUntil = 0;
      }
    }

    // Brake: если впереди стена в 1.2 секундах хода — тормозим.
    const lookAheadX = pos.x + vel.x * 1.2;
    const lookAheadZ = pos.z + vel.z * 1.2;
    const willHitWall =
      Math.abs(lookAheadX) > ARENA_HALF - 2 || Math.abs(lookAheadZ) > ARENA_HALF - 2;
    if (willHitWall && speed > 4 && now - mem.lastBrakeMs > 250) {
      brakeOverride = true;
      mem.lastBrakeMs = now;
    }
    // Brake при побеге, если уже скорость близка к лимиту — иначе скользим за стену.
    if (threat && speed > MAX_LINEAR_SPEED * 0.7 && Math.random() < tuning.brakeTendency * 0.4) {
      brakeOverride = true;
    }

    const outLen = Math.hypot(dx, dz);
    if (outLen < 1e-4) {
      return { moveX: 0, moveZ: 0, brake: brakeOverride, boost: false };
    }

    // Не тратим boost впустую, если нет реального движения вперёд.
    if (boost) {
      const proj = (dx * vel.x + dz * vel.z) / (outLen * (speed + 0.1));
      if (proj < -0.4) boost = false; // мы ещё едем «не туда»
      if (myMass < tuning.boostMassFloor + 0.3) boost = false;
    }

    return {
      moveX: dx / outLen,
      moveZ: dz / outLen,
      brake: brakeOverride || (chasing === false && threat !== null && speed > 3 && Math.random() < 0.04),
      boost,
    };
  }

  private pruneClaims(now: number): void {
    for (const m of this.memory.values()) {
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

// Утилитарно: использовать `BOOST_MASS_DRAIN_PER_SEC` чтобы не словить unused import.
void BOOST_MASS_DRAIN_PER_SEC;
