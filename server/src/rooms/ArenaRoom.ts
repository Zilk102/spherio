import { Client, Room } from "@colyseus/core";
import {
  ARENA_HALF,
  BOT_COUNT,
  MIN_RADIUS,
  PLAYER_COLORS,
  TICK_DT,
  TICK_RATE,
  listFreeSkins,
  randomBotAppearance,
  scoreFromRadius,
} from "@spherio/shared";
import type { ChatMessage, InputMessage, JoinOptions, MatchEndMessage } from "@spherio/shared";
import { getGuest, verifyToken } from "../services/auth.js";
import { pool } from "../db/pool.js";
import { filterChatText } from "../services/chatFilter.js";
import { recordMatchEnd } from "../services/stats.js";
import { submitScore } from "../services/leaderboard.js";
import { colorForSkin, resolveSkinForJoin } from "../util/playerSkin.js";
import { ArenaState, PelletState, PlayerState } from "../schema/ArenaState.js";
import { PhysicsWorld } from "../game/PhysicsWorld.js";
import { PelletManager } from "../game/PelletManager.js";
import { EatResolver } from "../game/EatResolver.js";
import { BotAI } from "../game/BotAI.js";
import { randomBotName } from "../game/botNames.js";
import { PelletManager as PelletUtil } from "../game/PelletManager.js";
import { InputRateLimiter } from "../game/rateLimit.js";
import { enforceSpeedLimits } from "../game/anticheat.js";
import { sanitizeInput } from "../game/inputValidate.js";
import {
  applyBoostMassDrain,
  handleBoost,
  pushKillFeed,
} from "../game/PlayerActions.js";

interface SessionMeta {
  playerId: string;
  isBot: boolean;
  userId: string;
  guest: boolean;
  name: string;
}

interface SessionStats {
  kills: number;
  deaths: number;
  startMs: number;
  bestRadius: number;
}

const RECONNECT_SEC = 30;

export class ArenaRoom extends Room<ArenaState> {
  maxClients = 50;
  protected enableBots = true;

  private physics!: PhysicsWorld;
  private pellets = new PelletManager();
  private pelletData = new Map<string, { id: string; x: number; y: number; z: number }>();
  private eatResolver = new EatResolver();
  private rateLimiter = new InputRateLimiter();
  private invuln = new Map<string, number>();
  private botIds: string[] = [];
  private botAI = new BotAI();
  private botNamesUsed = new Set<string>();
  private sessionParts = new Map<string, string[]>();
  private sessionStats = new Map<string, SessionStats>();

  async onCreate(): Promise<void> {
    this.setState(new ArenaState());

    this.physics = new PhysicsWorld();
    await this.physics.init();

    for (const p of this.pellets.fill()) {
      this.pelletData.set(p.id, p);
    }
    this.syncPellets();

    if (this.enableBots) {
      for (let i = 0; i < BOT_COUNT; i++) {
        this.spawnBot(i);
      }
    }

    this.onMessage("input", (client, msg: InputMessage) => {
      if (!this.rateLimiter.allow(client.sessionId)) return;
      const clean = sanitizeInput(msg);
      if (!clean) return;
      const meta = (client as Client & { meta?: SessionMeta }).meta;
      if (!meta?.playerId) return;
      const sessionId = client.sessionId;
      const moveX = clamp(clean.moveX, -1, 1);
      const moveZ = clamp(clean.moveZ, -1, 1);
      const parts = this.sessionParts.get(sessionId) ?? [meta.playerId];

      for (const partId of parts) {
        this.physics.setInput(partId, {
          moveX,
          moveZ,
          brake: !!clean.brake,
          boost: !!clean.boost,
        });
      }

      handleBoost(this.physics, this.sessionParts, sessionId, !!clean.boost);
    });

    this.onMessage("chat", (client, msg: ChatMessage) => {
      const meta = (client as Client & { meta?: SessionMeta }).meta;
      const name =
        (msg.name?.trim() || this.state.players.get(meta?.playerId ?? "")?.name || "Игрок").slice(
          0,
          16,
        );
      const text = filterChatText(msg.text ?? "");
      if (!text) return;
      this.broadcast("chat", {
        name,
        text,
        at: msg.at ?? Date.now(),
      } satisfies ChatMessage);
    });

    this.setPatchRate(1000 / 30);
    this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_RATE);
    console.log("[ArenaRoom] Создана арена");
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    const sessionId = client.sessionId;
    const existing = this.sessionParts.get(sessionId);
    if (existing && existing.length > 0) {
      console.log(`[ArenaRoom] Реконнект ${sessionId}`);
      return;
    }

    const verified = options.token ? verifyToken(options.token) : null;
    const owned = await this.resolveOwned(verified);
    const name = (options.name?.trim() || `Игрок${this.clients.length}`).slice(0, 16);
    const playerId = sessionId;
    const margin = 5;
    const x = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    const z = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    const fallbackColor = PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];
    const skinId = resolveSkinForJoin(options.skinId, owned);
    const color = colorForSkin(skinId, options.skinColor ?? fallbackColor);

    this.physics.addPlayer(playerId, MIN_RADIUS, x, z);
    const ps = new PlayerState();
    ps.id = playerId;
    ps.name = name;
    ps.color = color;
    ps.skinId = skinId;
    ps.radius = MIN_RADIUS;
    this.state.players.set(playerId, ps);
    this.sessionParts.set(playerId, [playerId]);
    this.sessionStats.set(sessionId, {
      kills: 0,
      deaths: 0,
      startMs: Date.now(),
      bestRadius: MIN_RADIUS,
    });

    (client as Client & { meta?: SessionMeta }).meta = {
      playerId,
      isBot: false,
      userId: verified?.userId ?? sessionId,
      guest: verified?.guest ?? true,
      name,
    };
    console.log(`[ArenaRoom] ${name} вошёл`);
  }

  async onLeave(client: Client, consented?: boolean): Promise<void> {
    const sessionId = client.sessionId;
    if (consented) {
      this.finalizeSession(client, false);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SEC);
      console.log(`[ArenaRoom] Ожидание реконнекта ${sessionId}`);
    } catch {
      this.finalizeSession(client, true);
    }
  }

  /** @param sendMatchEnd — false при добровольном выходе «В меню» (без модалки итогов) */
  private finalizeSession(client: Client, sendMatchEnd = true): void {
    const meta = (client as Client & { meta?: SessionMeta }).meta;
    const sessionId = client.sessionId;
    const stats = this.sessionStats.get(sessionId);
    const parts = this.sessionParts.get(sessionId) ?? (meta?.playerId ? [meta.playerId] : []);

    if (parts.length > 0 && meta && !meta.isBot) {
      const primary = this.state.players.get(meta.playerId);
      if (primary) {
        let bestR = primary.radius;
        for (const partId of parts) {
          const b = this.physics.getPlayer(partId);
          if (b && b.radius > bestR) bestR = b.radius;
        }
        const st = stats ?? {
          kills: 0,
          deaths: 0,
          startMs: Date.now(),
          bestRadius: bestR,
        };
        st.bestRadius = bestR;
        const timeSec = Math.max(1, Math.floor((Date.now() - st.startMs) / 1000));
        const score = scoreFromRadius(bestR);
        const humanCount = [...this.state.players.values()].filter((p) => !p.isBot).length;
        const rank = this.estimateRank(bestR);

        void submitScore(meta.userId, meta.name, bestR);
        void recordMatchEnd(meta.userId, meta.guest, {
          kills: st.kills,
          deaths: st.deaths,
          bestRadius: bestR,
          timeSec,
        });

        if (sendMatchEnd) {
          try {
            client.send("match_end", {
              score,
              kills: st.kills,
              deaths: st.deaths,
              timeSec,
              rank,
              players: humanCount,
            } satisfies MatchEndMessage);
          } catch {
            /* клиент уже отключён */
          }
        }
      }
      for (const partId of parts) {
        this.physics.removePlayer(partId);
        this.state.players.delete(partId);
        this.invuln.delete(partId);
      }
    }

    this.sessionParts.delete(sessionId);
    this.sessionStats.delete(sessionId);
    this.rateLimiter.remove(sessionId);
  }

  private estimateRank(radius: number): number {
    const scores = [...this.state.players.values()]
      .filter((p) => !p.isBot)
      .map((p) => p.radius)
      .sort((a, b) => b - a);
    const idx = scores.findIndex((r) => r <= radius);
    return idx < 0 ? scores.length : idx + 1;
  }

  private async resolveOwned(
    verified: { userId: string; guest: boolean } | null,
  ): Promise<string[]> {
    const free = listFreeSkins().map((s) => s.id);
    if (!verified) return free;
    if (verified.guest) {
      return getGuest(verified.userId)?.ownedSkinIds ?? free;
    }
    if (!pool) return free;
    const r = await pool.query<{ owned_skin_ids: string[] }>(
      `SELECT owned_skin_ids FROM users WHERE id = $1`,
      [verified.userId],
    );
    return r.rows[0]?.owned_skin_ids ?? free;
  }

  private findSessionByPart(partId: string): string | null {
    for (const [sessionId, parts] of this.sessionParts) {
      if (parts.includes(partId)) return sessionId;
    }
    const base = partId.split("~")[0];
    if (this.sessionParts.has(base)) return base;
    return null;
  }

  private spawnBot(index: number): void {
    const id = `bot_${index}`;
    const angle = (index / BOT_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const ring = ARENA_HALF * (0.35 + (index % 3) * 0.12);
    const x = Math.cos(angle) * ring;
    const z = Math.sin(angle) * ring;
    this.physics.addPlayer(id, MIN_RADIUS, x, z);
    const ps = new PlayerState();
    ps.id = id;
    ps.name = randomBotName(this.botNamesUsed);
    const botLook = randomBotAppearance();
    ps.skinId = botLook.skinId;
    ps.color = botLook.color;
    ps.radius = MIN_RADIUS;
    ps.isBot = true;
    this.state.players.set(id, ps);
    this.botIds.push(id);
  }

  private tick(dtMs: number): void {
    const dt = Math.min(dtMs / 1000, TICK_DT * 2);

    for (const botId of this.botIds) {
      if (!this.state.players.has(botId)) continue;
      this.physics.setInput(
        botId,
        this.botAI.decide(botId, this.physics, this.pelletData, Date.now(), this.invuln, dt),
      );
    }

    this.physics.step(dt);
    applyBoostMassDrain(this.physics, this.sessionParts, dt);
    this.nudgeStuckBots();
    enforceSpeedLimits(this.physics.getAllPlayers());
    const now = Date.now();
    const events = this.eatResolver.resolve(
      this.physics,
      this.state,
      this.pelletData,
      this.sessionParts,
      now,
      this.invuln,
    );

    for (const e of events.pelletEaten) {
      const respawned = this.pellets.respawn(e.pelletId);
      this.pelletData.set(e.pelletId, respawned);
      const killerSession = this.findSessionByPart(e.eaterId);
      if (killerSession) {
        const st = this.sessionStats.get(killerSession);
        if (st) st.bestRadius = Math.max(st.bestRadius, e.newRadius);
      }
    }

    for (const e of events.playerEaten) {
      PelletUtil.scatterDeathLoot(
        e.victimX,
        e.victimZ,
        e.victimRadius,
        e.scatterMass,
        this.pelletData,
      );
      pushKillFeed(this.state, e.killerName, e.victimName, now);

      const killerSession = this.findSessionByPart(e.eaterId);
      const victimSession = this.findSessionByPart(e.victimOwnerId);
      if (killerSession) {
        const st = this.sessionStats.get(killerSession);
        if (st) {
          st.kills += 1;
          st.bestRadius = Math.max(st.bestRadius, e.newRadius);
        }
      }
      if (victimSession) {
        const st = this.sessionStats.get(victimSession);
        if (st) st.deaths += 1;
      }
    }

    this.syncPlayers(now);
    if (events.pelletEaten.length > 0 || events.playerEaten.length > 0) {
      this.syncPellets();
    }
  }

  private nudgeStuckBots(): void {
    for (const botId of this.botIds) {
      const p = this.physics.getPlayer(botId);
      if (!p) continue;
      const t = p.body.translation();
      const v = p.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      const nearWall =
        Math.abs(t.x) > ARENA_HALF - 12 || Math.abs(t.z) > ARENA_HALF - 12;
      if (speed < 0.55 && nearWall) {
        const cx = -t.x;
        const cz = -t.z;
        const len = Math.hypot(cx, cz) || 1;
        const nudge = 2.5 * p.mass;
        p.body.applyImpulse({ x: (cx / len) * nudge, y: 0, z: (cz / len) * nudge }, true);
      }
    }
  }

  private syncPlayers(now: number): void {
    for (const [id, ps] of this.state.players) {
      const body = this.physics.getPlayer(id);
      if (!body) continue;
      const t = body.body.translation();
      const v = body.body.linvel();
      const r = body.body.rotation();
      ps.x = t.x;
      ps.y = t.y;
      ps.z = t.z;
      ps.vx = v.x;
      ps.vz = v.z;
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
