import { TICK_RATE } from "@spherio/shared";

const FRAME_MS = 1000 / TICK_RATE;

/** Задержка отображения: ~1 тик + доля RTT. */
export function interpDelayMs(pingMs: number): number {
  const ping = Math.max(0, pingMs);
  return Math.min(90, Math.max(FRAME_MS, ping * 0.4));
}

export class ServerClock {
  private offsetMs = 0;
  private synced = false;

  onServerTime(serverTimeMs: number): void {
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
    const target = serverTimeMs - Date.now();
    if (!this.synced) {
      this.offsetMs = target;
      this.synced = true;
    } else {
      this.offsetMs += (target - this.offsetMs) * 0.15;
    }
  }

  estimateNow(): number {
    return Date.now() + this.offsetMs;
  }

  renderTimeMs(pingMs: number): number {
    return this.estimateNow() - interpDelayMs(pingMs);
  }

  reset(): void {
    this.offsetMs = 0;
    this.synced = false;
  }
}
