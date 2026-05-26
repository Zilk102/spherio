import type { InputMessage } from "@spherio/shared";
import {
  type KinematicBody,
  kinematicBodyFromSnap,
  kinematicStep,
  reconcileKinematic,
} from "@spherio/shared";
import { isLocalPart } from "../lib/playerParts.js";

interface PartPredictor {
  body: KinematicBody;
  input: InputMessage;
}

/**
 * Client-side prediction: кинематическая симуляция позиции локальных частей.
 * Вращение на экране берётся из серверного state (Rapier) — см. EntitySync.
 */
export class LocalPredictor {
  private parts = new Map<string, PartPredictor>();

  prune(validIds: Set<string>, sessionId: string | null): void {
    for (const id of [...this.parts.keys()]) {
      if (!validIds.has(id) && isLocalPart(id, sessionId)) {
        this.parts.delete(id);
      }
    }
  }

  ensurePart(
    id: string,
    snap: {
      x: number;
      y: number;
      z: number;
      vx: number;
      vz: number;
      radius: number;
    },
  ): void {
    let p = this.parts.get(id);
    if (!p) {
      p = {
        body: kinematicBodyFromSnap(snap.x, snap.y, snap.z, snap.vx, snap.vz, snap.radius),
        input: { moveX: 0, moveZ: 0, brake: false, boost: false },
      };
      this.parts.set(id, p);
      return;
    }
    const dist = Math.hypot(snap.x - p.body.x, snap.z - p.body.z);
    const rDiff = Math.abs(snap.radius - p.body.radius);
    const hardSnap = dist > 6 || rDiff > 1.2;
    const blend = hardSnap ? 1 : 0.35;
    reconcileKinematic(
      p.body,
      snap.x,
      snap.y,
      snap.z,
      snap.vx,
      snap.vz,
      snap.radius,
      blend,
    );
  }

  setInputForSession(sessionId: string | null, input: InputMessage): void {
    if (!sessionId) return;
    for (const [id, p] of this.parts) {
      if (isLocalPart(id, sessionId)) {
        p.input = { ...input };
      }
    }
  }

  simulate(dt: number): void {
    if (dt <= 0) return;
    for (const p of this.parts.values()) {
      kinematicStep(p.body, p.input, dt);
    }
  }

  getPredicted(id: string): PartPredictor | undefined {
    return this.parts.get(id);
  }

  /** Скорость после prediction (для следов и HUD). */
  getVelocity(id: string): { vx: number; vz: number } | null {
    const p = this.parts.get(id);
    if (!p) return null;
    return { vx: p.body.vx, vz: p.body.vz };
  }
}
