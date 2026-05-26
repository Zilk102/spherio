import {
  ARENA_HALF,
  HEDGEHOG_COUNT_MAX,
  HEDGEHOG_COUNT_MIN,
  HEDGEHOG_RADIUS_MAX,
  HEDGEHOG_RADIUS_MIN,
  HEDGEHOG_SPEED_MAX,
  HEDGEHOG_SPEED_MIN,
} from "@spherio/shared";
import type { PhysicsWorld } from "./PhysicsWorld.js";

export type HedgehogPathKind = "line_x" | "line_z" | "circle" | "square";

export interface HedgehogData {
  id: string;
  x: number;
  z: number;
  radius: number;
  speed: number;
  spin: number;
  kind: HedgehogPathKind;
  /** Для line: 0..1 между концами. Для loop: индекс сегмента + t. */
  pathT: number;
  pathDir: 1 | -1;
  segIndex: number;
  segT: number;
  waypoints: { x: number; z: number }[];
}

export interface HedgehogVictimHit {
  victimId: string;
  hedgehogId: string;
}

const PATH_KINDS: HedgehogPathKind[] = ["line_x", "line_z", "circle", "square"];

function clampArena(v: number, margin = 8): number {
  const m = ARENA_HALF - margin;
  return Math.max(-m, Math.min(m, v));
}

function buildPath(kind: HedgehogPathKind): { waypoints: { x: number; z: number }[] } {
  const margin = 9;
  switch (kind) {
    case "line_x": {
      const z = clampArena((Math.random() * 2 - 1) * (ARENA_HALF - 14), 12);
      return {
        waypoints: [
          { x: -ARENA_HALF + margin, z },
          { x: ARENA_HALF - margin, z },
        ],
      };
    }
    case "line_z": {
      const x = clampArena((Math.random() * 2 - 1) * (ARENA_HALF - 14), 12);
      return {
        waypoints: [
          { x, z: -ARENA_HALF + margin },
          { x, z: ARENA_HALF - margin },
        ],
      };
    }
    case "circle": {
      const cx = clampArena((Math.random() * 2 - 1) * 28, 14);
      const cz = clampArena((Math.random() * 2 - 1) * 28, 14);
      const r = 10 + Math.random() * 16;
      const n = 12;
      const waypoints: { x: number; z: number }[] = [];
      const phase = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2;
        waypoints.push({
          x: clampArena(cx + Math.cos(a) * r),
          z: clampArena(cz + Math.sin(a) * r),
        });
      }
      return { waypoints };
    }
    case "square":
    default: {
      const cx = clampArena((Math.random() * 2 - 1) * 22, 14);
      const cz = clampArena((Math.random() * 2 - 1) * 22, 14);
      const half = 8 + Math.random() * 10;
      return {
        waypoints: [
          { x: cx - half, z: cz - half },
          { x: cx + half, z: cz - half },
          { x: cx + half, z: cz + half },
          { x: cx - half, z: cz + half },
        ],
      };
    }
  }
}

export class HedgehogManager {
  private hedgehogs = new Map<string, HedgehogData>();
  private nextId = 0;

  fill(): HedgehogData[] {
    this.hedgehogs.clear();
    const count =
      HEDGEHOG_COUNT_MIN +
      Math.floor(Math.random() * (HEDGEHOG_COUNT_MAX - HEDGEHOG_COUNT_MIN + 1));
    for (let i = 0; i < count; i++) {
      const h = this.spawnOne(i);
      this.hedgehogs.set(h.id, h);
    }
    return [...this.hedgehogs.values()];
  }

  private spawnOne(_slot: number): HedgehogData {
    const kind = PATH_KINDS[Math.floor(Math.random() * PATH_KINDS.length)]!;
    const { waypoints } = buildPath(kind);
    const radius =
      HEDGEHOG_RADIUS_MIN +
      Math.random() * (HEDGEHOG_RADIUS_MAX - HEDGEHOG_RADIUS_MIN);
    const speed =
      HEDGEHOG_SPEED_MIN +
      Math.random() * (HEDGEHOG_SPEED_MAX - HEDGEHOG_SPEED_MIN);
    const wp0 = waypoints[0]!;
    const isLine = kind === "line_x" || kind === "line_z";
    return {
      id: `h${this.nextId++}`,
      x: wp0.x,
      z: wp0.z,
      radius,
      speed,
      spin: speed / radius,
      kind,
      pathT: 0,
      pathDir: 1,
      segIndex: 0,
      segT: 0,
      waypoints,
    };
  }

  getAll(): HedgehogData[] {
    return [...this.hedgehogs.values()];
  }

  step(dt: number): void {
    if (dt <= 0) return;
    for (const h of this.hedgehogs.values()) {
      if (h.kind === "line_x" || h.kind === "line_z") {
        this.stepLine(h, dt);
      } else {
        this.stepLoop(h, dt);
      }
    }
  }

  /** Туда-обратно между двумя точками (стенка ↔ стенка). */
  private stepLine(h: HedgehogData, dt: number): void {
    const a = h.waypoints[0]!;
    const b = h.waypoints[1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    h.pathT += (h.speed * dt) / len * h.pathDir;
    if (h.pathT >= 1) {
      h.pathT = 1;
      h.pathDir = -1;
    } else if (h.pathT <= 0) {
      h.pathT = 0;
      h.pathDir = 1;
    }
    h.x = a.x + (b.x - a.x) * h.pathT;
    h.z = a.z + (b.z - a.z) * h.pathT;
  }

  /** Замкнутый маршрут (круг, квадрат). */
  private stepLoop(h: HedgehogData, dt: number): void {
    const n = h.waypoints.length;
    if (n < 2) return;

    const from = h.waypoints[h.segIndex]!;
    const to = h.waypoints[(h.segIndex + 1) % n]!;
    const segLen = Math.hypot(to.x - from.x, to.z - from.z) || 1;

    h.segT += (h.speed * dt) / segLen;
    while (h.segT >= 1) {
      h.segT -= 1;
      h.segIndex = (h.segIndex + 1) % n;
    }

    const a = h.waypoints[h.segIndex]!;
    const b = h.waypoints[(h.segIndex + 1) % n]!;
    h.x = a.x + (b.x - a.x) * h.segT;
    h.z = a.z + (b.z - a.z) * h.segT;
  }

  checkCollisions(
    physics: PhysicsWorld,
    invuln: Map<string, number>,
    now: number,
  ): HedgehogVictimHit[] {
    const hits: HedgehogVictimHit[] = [];
    const hitVictims = new Set<string>();

    for (const h of this.hedgehogs.values()) {
      for (const player of physics.getAllPlayers()) {
        if (hitVictims.has(player.id)) continue;
        if ((invuln.get(player.id) ?? 0) > now) continue;

        const pos = player.body.translation();
        const dx = h.x - pos.x;
        const dz = h.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= h.radius + player.radius * 0.9) continue;

        hits.push({ victimId: player.id, hedgehogId: h.id });
        hitVictims.add(player.id);
      }
    }
    return hits;
  }

  static visualRotation(h: HedgehogData, tMs: number): {
    qx: number;
    qy: number;
    qz: number;
    qw: number;
  } {
    let dx = 0;
    let dz = 0;
    if (h.kind === "line_x" || h.kind === "line_z") {
      const a = h.waypoints[0]!;
      const b = h.waypoints[1]!;
      dx = b.x - a.x;
      dz = b.z - a.z;
    } else {
      const n = h.waypoints.length;
      const from = h.waypoints[h.segIndex] ?? { x: h.x, z: h.z };
      const to = h.waypoints[(h.segIndex + 1) % n] ?? from;
      dx = to.x - from.x;
      dz = to.z - from.z;
    }
    const yaw = Math.atan2(dx, dz);
    const roll = (tMs / 1000) * h.spin * 1.4;
    const half = roll * 0.5;
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);
    const cr = Math.cos(half);
    const sr = Math.sin(half);
    return {
      qx: sr * cy,
      qy: sy * cr,
      qz: -sr * sy,
      qw: cr * cy,
    };
  }
}
