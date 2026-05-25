import { Client } from "@colyseus/core";
import type { JoinOptions } from "@spherio/shared";
import { ArenaRoom } from "./ArenaRoom.js";

interface PrivateCreateOptions {
  code?: string;
  maxClients?: number;
  enableBots?: boolean;
}

export class PrivateArenaRoom extends ArenaRoom {
  private lobbyCode = "";

  async onCreate(options: PrivateCreateOptions = {}): Promise<void> {
    this.lobbyCode = String(options.code ?? generateCode()).toUpperCase();
    if (options.maxClients) this.maxClients = options.maxClients;
    this.enableBots = !!options.enableBots;
    this.setMetadata({
      code: this.lobbyCode,
      private: true,
      enableBots: this.enableBots,
    });
    await super.onCreate();
    console.log(`[PrivateArena] ${this.lobbyCode} bots=${this.enableBots}`);
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    const code = (options.code ?? "").toUpperCase();
    if (code !== this.lobbyCode) {
      throw new Error("Неверный код лобби");
    }
    await super.onJoin(client, options);
  }
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
