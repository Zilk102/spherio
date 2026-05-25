import { Client, Room } from "colyseus";
import {
  ARENA_HALF,
  BOT_COUNT,
  MIN_RADIUS,
  PLAYER_COLORS,
  TICK_DT,
  TICK_RATE,
} from "@spherio/shared";
import type { InputMessage, JoinOptions } from "@spherio/shared";
import { ArenaState, PelletState, PlayerState } from "../schema/ArenaState.js";
import { PhysicsWorld } from "../game/PhysicsWorld.js";
import { PelletManager } from "../game/PelletManager.js";
import { EatResolver } from "../game/EatResolver.js";
import { InputRateLimiter } from "../game/rateLimit.js";

interface SessionMeta {
  playerId: string;
  isBot: boolean;
}

export class ArenaRoom extends Room<ArenaState> {
  maxClients = 50;
  state = new ArenaState();

  private physics!: PhysicsWorld;
  private pellets = new PelletManager();
  private pelletData = new Map<string, { id: string; x: number; y: number; z: number }>();
  private eatResolver = new EatResolver();
  private rateLimiter = new InputRateLimiter();
  private invuln = new Map<string, number>();
  private botIds: string[] = [];

  async onCreate(): Promise<void> {
    this.physics = new PhysicsWorld();
    await this.physics.init();

    for (const p of this.pellets.fill()) {
      this.pelletData.set(p.id, p);
    }
    this.syncPellets();

    for (let i = 0; i < BOT_COUNT; i++) {
      this.spawnBot(i);
    }

    this.onMessage("input", (client, msg: InputMessage) => {
      if (!this.rateLimiter.allow(client.sessionId)) return;
      const meta = (client as Client & { meta?: SessionMeta }).meta;
      if (!meta?.playerId) return;
      this.physics.setInput(meta.playerId, {
        moveX: clamp(msg.moveX, -1, 1),
        moveZ: clamp(msg.moveZ, -1, 1),
        brake: !!msg.brake,
      });
    });

    this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_RATE);
    console.log("[ArenaRoom] Создана арена");
  }

  onJoin(client: Client, options: JoinOptions): void {
    const name = (options.name?.trim() || `Игрок${this.state.players.size + 1}`).slice(0, 16);
    const playerId = client.sessionId;
    const margin = 5;
    const x = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    const z = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    const color = PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];

    this.physics.addPlayer(playerId, MIN_RADIUS, x, z);
    const ps = new PlayerState();
    ps.id = playerId;
    ps.name = name;
    ps.color = color;
    ps.radius = MIN_RADIUS;
    this.state.players.set(playerId, ps);

    (client as Client & { meta?: SessionMeta }).meta = { playerId, isBot: false };
    console.log(`[ArenaRoom] ${name} вошёл`);
  }

  onLeave(client: Client): void {
    const meta = (client as Client & { meta?: SessionMeta }).meta;
    if (meta?.playerId) {
      this.physics.removePlayer(meta.playerId);
      this.state.players.delete(meta.playerId);
      this.invuln.delete(meta.playerId);
    }
    this.rateLimiter.remove(client.sessionId);
  }

  private spawnBot(index: number): void {
    const id = `bot_${index}`;
    const margin = 8;
    const x = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    const z = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    this.physics.addPlayer(id, MIN_RADIUS, x, z);
    const ps = new PlayerState();
    ps.id = id;
    ps.name = `Бот ${index + 1}`;
    ps.color = PLAYER_COLORS[(index + 3) % PLAYER_COLORS.length];
    ps.radius = MIN_RADIUS;
    ps.isBot = true;
    this.state.players.set(id, ps);
    this.botIds.push(id);
  }

  private tick(dtMs: number): void {
    const dt = Math.min(dtMs / 1000, TICK_DT * 2);

    for (const botId of this.botIds) {
      if (!this.state.players.has(botId)) continue;
      const angle = Date.now() * 0.001 + botId.charCodeAt(4);
      this.physics.setInput(botId, {
        moveX: Math.cos(angle),
        moveZ: Math.sin(angle),
        brake: Math.random() < 0.02,
      });
    }

    this.physics.step(dt);
    const now = Date.now();
    const events = this.eatResolver.resolve(
      this.physics,
      this.pelletData,
      now,
      this.invuln,
    );

    for (const e of events.pelletEaten) {
      const respawned = this.pellets.respawn(e.pelletId);
      this.pelletData.set(e.pelletId, respawned);
    }

    this.syncPlayers(now);
    if (events.pelletEaten.length > 0) {
      this.syncPellets();
    }
  }

  private syncPlayers(now: number): void {
    for (const [id, ps] of this.state.players) {
      const body = this.physics.getPlayer(id);
      if (!body) continue;
      const t = body.body.translation();
      const r = body.body.rotation();
      ps.x = t.x;
      ps.y = t.y;
      ps.z = t.z;
      ps.qx = r.x;
      ps.qy = r.y;
      ps.qz = r.z;
      ps.qw = r.w;
      ps.radius = body.radius;
      ps.invulnUntil = this.invuln.get(id) ?? 0;
    }
  }

  private syncPellets(): void {
    this.state.pellets.clear();
    for (const p of this.pelletData.values()) {
      const s = new PelletState();
      s.id = p.id;
      s.x = p.x;
      s.y = p.y;
      s.z = p.z;
      this.state.pellets.push(s);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
