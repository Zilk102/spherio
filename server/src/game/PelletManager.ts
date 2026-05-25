import {
  ARENA_HALF,
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
      y: PELLET_RADIUS,
      z: (Math.random() * 2 - 1) * (ARENA_HALF - margin),
    };
    return pellet;
  }

  respawn(id: string): PelletData {
    const p = this.spawnOne();
    p.id = id;
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
}
