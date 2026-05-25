import { Client } from "@colyseus/core";
import {
  PRIVATE_IDLE_GRACE_MS,
  PRIVATE_MIN_HUMANS_TO_START,
} from "@spherio/shared";
import type { JoinOptions } from "@spherio/shared";
import { ArenaRoom } from "./ArenaRoom.js";

interface PrivateCreateOptions {
  code?: string;
  maxClients?: number;
  enableBots?: boolean;
}

export class PrivateArenaRoom extends ArenaRoom {
  private lobbyCode = "";
  private idleSinceMs = 0;
  private idleCheckHandle: ReturnType<typeof setInterval> | null = null;

  async onCreate(options: PrivateCreateOptions = {}): Promise<void> {
    this.lobbyCode = String(options.code ?? generateCode()).toUpperCase();
    if (options.maxClients) this.maxClients = options.maxClients;
    this.enableBots = !!options.enableBots;
    this.isPrivateRoom = true;
    this.setMetadata({
      code: this.lobbyCode,
      private: true,
      enableBots: this.enableBots,
    });
    await super.onCreate();

    // С момента создания комнаты до прихода первого реального игрока: 5 минут idle-grace.
    this.idleSinceMs = Date.now();
    this.idleCheckHandle = setInterval(() => this.checkIdle(), 5000);

    console.log(`[PrivateArena] ${this.lobbyCode} bots=${this.enableBots}`);
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    const code = (options.code ?? "").toUpperCase();
    if (code !== this.lobbyCode) {
      throw new Error("Неверный код лобби");
    }
    await super.onJoin(client, options);
  }

  /** Хук от ArenaRoom: пришёл живой игрок. */
  protected onHumanJoined(): void {
    this.idleSinceMs = 0;
    if (this.state.matchEndsAt > 0) return; // таймер уже запущен
    if (this.humanCount() >= PRIVATE_MIN_HUMANS_TO_START) {
      this.startMatchTimer();
    }
  }

  /** Хук от ArenaRoom: игрок ушёл. */
  protected onHumanLeft(): void {
    if (this.humanCount() === 0) {
      this.idleSinceMs = Date.now();
    }
  }

  private checkIdle(): void {
    if (!this.idleSinceMs) return;
    if (this.humanCount() > 0) {
      this.idleSinceMs = 0;
      return;
    }
    if (Date.now() - this.idleSinceMs >= PRIVATE_IDLE_GRACE_MS) {
      console.log(`[PrivateArena] ${this.lobbyCode} idle ${PRIVATE_IDLE_GRACE_MS / 60000} мин → dispose`);
      this.disconnect().catch(() => undefined);
    }
  }

  async onDispose(): Promise<void> {
    if (this.idleCheckHandle) {
      clearInterval(this.idleCheckHandle);
      this.idleCheckHandle = null;
    }
  }
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
