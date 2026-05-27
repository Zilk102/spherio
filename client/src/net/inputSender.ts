import type { Room } from "colyseus.js";
import type { InputMessage } from "@spherio/shared";
import { TICK_RATE } from "@spherio/shared";

const SEND_INTERVAL_MS = 1000 / TICK_RATE;

/** Не слать input каждый кадр рендера — только ~30 Гц. */
export class InputSender {
  private lastSendMs = 0;
  private pending: InputMessage | null = null;

  reset(): void {
    this.lastSendMs = 0;
    this.pending = null;
  }

  send(room: Room | null, input: InputMessage, nowMs: number): void {
    if (!room) return;
    this.pending = input;
    if (nowMs - this.lastSendMs < SEND_INTERVAL_MS) return;
    this.flush(room, nowMs);
  }

  flush(room: Room, nowMs = Date.now()): void {
    if (!this.pending) return;
    room.send("input", this.pending);
    this.lastSendMs = nowMs;
    this.pending = null;
  }
}
