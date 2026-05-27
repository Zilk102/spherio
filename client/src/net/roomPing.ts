import type { Room } from "colyseus.js";

/** RTT через ping/pong (Colyseus connection.rtt часто 0). */
export class RoomPing {
  private rttMs = 0;
  private lastSendMs = 0;
  private readonly intervalMs = 2000;
  private room: Room | null = null;

  attach(room: Room): void {
    this.detach();
    this.room = room;
    this.rttMs = 0;
    this.lastSendMs = 0;
    room.onMessage("pong", () => {
      if (this.lastSendMs > 0) {
        this.rttMs = Math.max(0, Date.now() - this.lastSendMs);
      }
    });
    this.sendPing();
  }

  detach(): void {
    this.room = null;
  }

  tick(nowMs = Date.now()): void {
    if (!this.room) return;
    if (nowMs - this.lastSendMs >= this.intervalMs) {
      this.sendPing();
    }
  }

  get(): number {
    return this.rttMs;
  }

  private sendPing(): void {
    if (!this.room) return;
    this.lastSendMs = Date.now();
    this.room.send("ping", {});
  }
}
