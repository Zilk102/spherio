import {
  ARENA_HALF,
  GROUND_Y,
  MAX_DEATH_SCATTER_PELLETS,
  PELLET_COUNT,
  PELLET_MASS_VALUE,
  PELLET_RADIUS,
} from "@spherio/shared";
import { radiusFromMass, massFromRadius } from "@spherio/shared";

export interface PelletData {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Масса при поедании (орбы с трупа — крупнее обычных). */
  massValue?: number;
}

export class PelletManager {
  private pellets = new Map<string, PelletData>();
  private nextId = 0;

  fill(): PelletData[] {
    this.pellets.clear();
    for (let i = 0; i < PELLET_COUNT; i++) {
      const p = this.spawnOne();
      this.pellets.set(p.id, p);
    }
    return [...this.pellets.values()];
  }

  private spawnOne(): PelletData {
    const margin = 2;
    const id = `p${this.nextId++}`;
    const pellet: PelletData = {
      id,
      x: (Math.random() * 2 - 1) * (ARENA_HALF - margin),
      y: GROUND_Y + PELLET_RADIUS,
      z: (Math.random() * 2 - 1) * (ARENA_HALF - margin),
    };
    return pellet;
  }

  respawn(id: string): PelletData {
    const p = this.spawnOne();
    p.id = id;
    delete p.massValue;
    this.pellets.set(id, p);
    return p;
  }

  remove(id: string): void {
    this.pellets.delete(id);
  }

  static pelletMassGain(): number {
    return PELLET_MASS_VALUE;
  }

  static applyMassGain(currentRadius: number, gain: number): number {
    const mass = massFromRadius(currentRadius) + gain;
    return radiusFromMass(mass);
  }

  static massGainFor(pellet: PelletData): number {
    return pellet.massValue ?? PELLET_MASS_VALUE;
  }

  /**
   * Рассыпает массу жертвы орбами в зоне убийства (slither-style).
   * Переставляет существующие пеллеты из пула, не увеличивая их число.
   */
  static scatterDeathLoot(
    centerX: number,
    centerZ: number,
    victimRadius: number,
    totalMass: number,
    data: Map<string, PelletData>,
  ): void {
    if (totalMass <= 1e-6 || data.size === 0) return;

    const count = Math.min(
      Math.max(6, Math.ceil(totalMass / PELLET_MASS_VALUE)),
      MAX_DEATH_SCATTER_PELLETS,
      data.size,
    );
    const massEach = totalMass / count;
    const zone = victimRadius * 1.6 + 1.5;

    const ids = [...data.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const r = zone * Math.sqrt(t);
      const a = Math.random() * Math.PI * 2;
      let x = centerX + Math.cos(a) * r;
      let z = centerZ + Math.sin(a) * r;
      x = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, x));
      z = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, z));

      const id = ids[i]!;
      data.set(id, {
        id,
        x,
        y: GROUND_Y + PELLET_RADIUS,
        z,
        massValue: massEach,
      });
    }
  }
}
