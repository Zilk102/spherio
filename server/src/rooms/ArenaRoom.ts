import { Client, Room } from "@colyseus/core";
import {
  ARENA_HALF,
  BOT_COUNT,
  DEATH_SCATTER_FRACTION,
  GROUND_Y,
  MATCH_DURATION_MS,
  MATCH_END_HOLD_MS,
  MIN_RADIUS,
  PLAYER_COLORS,
  RESPAWN_INVULN_MS,
  TICK_DT,
  TICK_RATE,
  listFreeSkins,
  massFromRadius,
  playerOwnerKey,
  radiusFromMass,
  randomBotAppearance,
  scoreFromRadius,
} from "@spherio/shared";
import type {
  ChatMessage,
  InputMessage,
  JoinOptions,
  MatchEndMessage,
  MatchLeaderboardRow,
  MatchResultsMessage,
  SplitMessage,
} from "@spherio/shared";
import { getGuest, verifyToken } from "../services/auth.js";
import { pool } from "../db/pool.js";
import { filterChatText } from "../services/chatFilter.js";
import { recordMatchEnd } from "../services/stats.js";
import { submitScore } from "../services/leaderboard.js";
import { colorForSkin, resolveSkinForJoin } from "../util/playerSkin.js";
import {
  ArenaState,
  HedgehogState,
  PelletState,
  PlayerState,
} from "../schema/ArenaState.js";
import { PhysicsWorld } from "../game/PhysicsWorld.js";
import { PelletManager, type PelletData } from "../game/PelletManager.js";
import { HedgehogManager, type HedgehogVictimHit } from "../game/HedgehogManager.js";
import { EatResolver } from "../game/EatResolver.js";
import { BotAI } from "../game/BotAI.js";
import { TargetSystem } from "../game/TargetSystem.js";
import { trySplit, type SplitContext } from "../game/split.js";
import {
  applySplitRejoinPull,
  clearSplitContactForPart,
  resolveSplitMerges,
} from "../game/splitRejoin.js";
import { randomBotName } from "../game/botNames.js";
import { PelletManager as PelletUtil } from "../game/PelletManager.js";
import { InputRateLimiter } from "../game/rateLimit.js";
import { enforceSpeedLimits } from "../game/anticheat.js";
import { sanitizeInput } from "../game/inputValidate.js";
import { applyBoostMassDrain, handleBoost } from "../game/PlayerActions.js";
import type { KillFeedEntry } from "@spherio/shared";

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
  /** Override в PrivateArenaRoom. Управляет логикой матчмейкинга и leaderboard'а. */
  protected isPrivateRoom = false;

  private physics!: PhysicsWorld;
  private pellets = new PelletManager();
  private pelletData = new Map<string, PelletData>();
  private hedgehogs = new HedgehogManager();
  private eatResolver = new EatResolver();
  private rateLimiter = new InputRateLimiter();
  private invuln = new Map<string, number>();
  private botIds: string[] = [];
  private botAI = new BotAI();
  private targetSystem = new TargetSystem();
  private botNamesUsed = new Set<string>();
  private sessionParts = new Map<string, string[]>();
  private sessionStats = new Map<string, SessionStats>();
  /** true пока матч ещё не закончился по таймеру — в нём принимаются input и физика. */
  protected matchActive = true;
  /** sessionId-набор клиентов, которые уже получили per-player match_end (чтобы не отправлять дважды). */
  private endedSessions = new Set<string>();
  private matchEndScheduled = false;
  /** O(1) доступ к Client по sessionId (в tick не делаем clients.find). */
  private clientBySession = new Map<string, Client>();
  private splitCooldownUntil = new Map<string, number>();
  private lastSplitAttemptMs = new Map<string, number>();
  /** Время (ms), когда пара частей впервые соприкоснулась в этом контакте. */
  private splitContactSince = new Map<string, number>();
  private killFeedSeq = 0;

  async onCreate(): Promise<void> {
    this.setState(new ArenaState());
    this.state.isPrivate = this.isPrivateRoom;

    this.physics = new PhysicsWorld();
    await this.physics.init();

    for (const p of this.pellets.fill()) {
      this.pelletData.set(p.id, p);
    }
    this.hedgehogs.fill();
    this.syncPellets();
    this.syncHedgehogs();

    if (this.enableBots) {
      for (let i = 0; i < BOT_COUNT; i++) {
        this.spawnBot(i);
      }
      // У ботов первичные цели выдадим после спавна всех — чтобы было из чего выбирать.
      const now = Date.now();
      for (const botId of this.botIds) {
        this.targetSystem.assignTargetFor(botId, this.state, now, this.invuln);
      }
    }

    this.onMessage("ping", (client) => {
      client.send("pong", {});
    });

    this.onMessage("input", (client, msg: InputMessage) => {
      if (!this.matchActive) return;
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

    this.onMessage("split", (client, msg: SplitMessage) => {
      if (!this.matchActive) return;
      const meta = (client as Client & { meta?: SessionMeta }).meta;
      if (!meta?.playerId || meta.isBot) return;
      const sessionId = client.sessionId;
      const now = Date.now();
      const last = this.lastSplitAttemptMs.get(sessionId) ?? 0;
      if (now - last < 120) return;
      this.lastSplitAttemptMs.set(sessionId, now);

      const ctx: SplitContext = {
        physics: this.physics,
        state: this.state,
        sessionParts: this.sessionParts,
        splitCooldownUntil: this.splitCooldownUntil,
        invuln: this.invuln,
      };
      const primaryPs = this.state.players.get(meta.playerId);
      const result = trySplit(
        ctx,
        sessionId,
        {
          name: meta.name,
          color: primaryPs?.color ?? 0xffffff,
          skinId: primaryPs?.skinId ?? "emoji_grin",
        },
        msg ?? {},
        now,
      );
      if (!result.ok) {
        try {
          client.send("split_result", { ok: false, reason: result.reason });
        } catch {
          /* disconnected */
        }
        return;
      }

      this.targetSystem.onSplitPartSpawned(result.childId, this.state, now, this.invuln);

      try {
        client.send("split_result", { ok: true, childId: result.childId });
      } catch {
        /* disconnected */
      }
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

    // Публичная комната сразу стартует 15-минутный матч; приватная — после 2-го реального игрока.
    if (!this.isPrivateRoom) {
      this.startMatchTimer();
    }
    this.refreshMetadata();

    console.log(
      `[ArenaRoom] Создана арена (private=${this.isPrivateRoom}, bots=${this.enableBots})`,
    );
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    const sessionId = client.sessionId;
    this.clientBySession.set(sessionId, client);
    const existing = this.sessionParts.get(sessionId);
    if (existing && existing.length > 0) {
      const liveParts = [...this.state.players.keys()].filter(
        (id) => id === sessionId || id.startsWith(`${sessionId}~`),
      );
      if (liveParts.length > 0) {
        this.sessionParts.set(sessionId, liveParts);
      }
      console.log(`[ArenaRoom] Реконнект ${sessionId}`);
      return;
    }

    if (!this.matchActive) {
      throw new Error("Матч уже закончился");
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

    // Выдадим этому игроку случайную цель и подтянем тех, у кого цели нет.
    this.targetSystem.onPlayerSpawned(playerId, this.state, Date.now(), this.invuln);

    this.onHumanJoined();
    this.refreshMetadata();
  }

  async onLeave(client: Client, consented?: boolean): Promise<void> {
    const sessionId = client.sessionId;
    if (consented) {
      await this.finalizeSession(client, false);
      this.onHumanLeft();
      this.refreshMetadata();
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SEC);
      console.log(`[ArenaRoom] Ожидание реконнекта ${sessionId}`);
    } catch {
      await this.finalizeSession(client, true);
      this.onHumanLeft();
      this.refreshMetadata();
    }
  }

  private getClientBySession(sessionId: string): Client | undefined {
    return this.clientBySession.get(sessionId);
  }

  /** Хук — переопределяется в PrivateArenaRoom для запуска отложенного таймера. */
  protected onHumanJoined(): void {
    /* no-op в public */
  }

  /** Хук — переопределяется в PrivateArenaRoom для idle-grace. */
  protected onHumanLeft(): void {
    /* no-op в public */
  }

  /** Запустить серверный таймер матча 15 минут с текущего момента. */
  protected startMatchTimer(): void {
    if (this.state.matchEndsAt > 0) return;
    const now = Date.now();
    this.state.matchStartedAt = now;
    this.state.matchEndsAt = now + MATCH_DURATION_MS;
    this.state.matchPhase = "running";
    this.refreshMetadata();
    console.log(
      `[ArenaRoom] Матч стартовал, до конца ${(MATCH_DURATION_MS / 60000).toFixed(0)} мин (private=${this.isPrivateRoom})`,
    );
  }

  /** Текущее число «живых» (не-бот) сессий в комнате (с учётом потерянных, но в reconnect-окне). */
  protected humanCount(): number {
    return this.countHumanOwners();
  }

  /** Пишет актуальные данные в Colyseus metadata — клиент-матчмейкер опирается на них. */
  protected refreshMetadata(): void {
    const meta = (this.metadata ?? {}) as Record<string, unknown>;
    this.setMetadata({
      ...meta,
      private: this.isPrivateRoom,
      matchEndsAt: this.state.matchEndsAt,
      matchStartedAt: this.state.matchStartedAt,
      matchPhase: this.state.matchPhase,
      humanCount: this.humanCount(),
      maxClients: this.maxClients,
    });
  }

  /** Завершить матч по таймеру: разослать лидерборд, заморозить input, через MATCH_END_HOLD_MS dispose. */
  protected finishMatchByTimer(): void {
    void this.finishMatchByTimerAsync();
  }

  private async finishMatchByTimerAsync(): Promise<void> {
    if (!this.matchActive || this.matchEndScheduled) return;
    this.matchActive = false;
    this.matchEndScheduled = true;
    this.state.matchPhase = "ended";
    this.refreshMetadata();

    const rows = this.buildLeaderboard();
    const durationSec = Math.max(
      1,
      Math.floor((Date.now() - (this.state.matchStartedAt || Date.now())) / 1000),
    );

    // Финализируем сессии оставшихся реальных игроков (пишем stats/leaderboard в БД).
    const finalizeResults = await Promise.allSettled(
      [...this.clients].map((client) => this.finalizeSession(client, false)),
    );
    for (const r of finalizeResults) {
      if (r.status === "rejected") {
        console.error("[ArenaRoom] finalizeSession при окончании матча:", r.reason);
      }
    }

    // Заморозим ботов и физику игроков.
    for (const p of this.physics.getAllPlayers()) {
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    const payload: MatchResultsMessage = {
      reason: "timeup",
      durationSec,
      holdMs: MATCH_END_HOLD_MS,
      canRestartPublic: !this.isPrivateRoom,
      rows,
      isPrivate: this.isPrivateRoom,
    };

    // Каждому клиенту шлём персональный sessionId — чтобы клиент мог подсветить «себя».
    for (const client of this.clients) {
      try {
        client.send("match_results", {
          ...payload,
          rows: rows.map((r) => ({ ...r, sessionId: r.sessionId })),
          you: client.sessionId,
        });
      } catch {
        /* клиент отключился */
      }
    }

    console.log(
      `[ArenaRoom] match_results разослан (${rows.length} строк), dispose через ${MATCH_END_HOLD_MS}мс`,
    );

    this.clock.setTimeout(() => {
      this.disconnect().catch(() => undefined);
    }, MATCH_END_HOLD_MS);
  }

  /** Собрать топ: одна строка на игрока/бота (split-части суммируются по массе). */
  protected buildLeaderboard(): MatchLeaderboardRow[] {
    const grouped = new Map<
      string,
      {
        name: string;
        isBot: boolean;
        sessionId?: string;
        totalMass: number;
      }
    >();

    for (const [id, ps] of this.state.players) {
      const ownerKey = ps.isBot ? id : playerOwnerKey(id);
      let row = grouped.get(ownerKey);
      if (!row) {
        row = {
          name: ps.name || (ps.isBot ? "Бот" : "Игрок"),
          isBot: !!ps.isBot,
          sessionId: ps.isBot ? undefined : ownerKey,
          totalMass: 0,
        };
        grouped.set(ownerKey, row);
      }
      row.totalMass += massFromRadius(ps.radius);
    }

    const items: MatchLeaderboardRow[] = [];
    for (const [ownerKey, row] of grouped) {
      const radius = radiusFromMass(row.totalMass);
      items.push({
        id: ownerKey,
        name: row.name,
        score: scoreFromRadius(radius),
        radius,
        isBot: row.isBot,
        sessionId: row.sessionId,
      });
    }
    items.sort((a, b) => b.score - a.score);
    return items;
  }

  /** @param sendMatchEnd — false при добровольном выходе «В меню» (без модалки итогов) */
  private async finalizeSession(client: Client, sendMatchEnd = true): Promise<void> {
    const sessionId = client.sessionId;
    if (this.endedSessions.has(sessionId)) return;
    this.endedSessions.add(sessionId);
    const meta = (client as Client & { meta?: SessionMeta }).meta;
    const stats = this.sessionStats.get(sessionId);
    const parts = this.sessionParts.get(sessionId) ?? (meta?.playerId ? [meta.playerId] : []);

    if (parts.length > 0 && meta && !meta.isBot) {
      const primary = this.state.players.get(meta.playerId);
      if (primary) {
        let totalMass = 0;
        for (const partId of parts) {
          const b = this.physics.getPlayer(partId);
          if (b) totalMass += b.mass;
        }
        const bestR = radiusFromMass(totalMass);
        const st = stats ?? {
          kills: 0,
          deaths: 0,
          startMs: Date.now(),
          bestRadius: bestR,
        };
        st.bestRadius = bestR;
        const timeSec = Math.max(1, Math.floor((Date.now() - st.startMs) / 1000));
        const score = scoreFromRadius(bestR);
        const humanCount = this.countHumanOwners();
        const rank = this.estimateRank(bestR);

        // Глобальный топ/ежедневный/долгосрочные user_stats пишем ТОЛЬКО из публичных матчей.
        if (!this.isPrivateRoom) {
          await this.persistPublicMatchStats(meta, st, bestR, timeSec);
        }

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
        clearSplitContactForPart(this.splitContactSince, partId);
        this.physics.removePlayer(partId);
        this.state.players.delete(partId);
        this.invuln.delete(partId);
      }
    }

    this.sessionParts.delete(sessionId);
    this.sessionStats.delete(sessionId);
    this.rateLimiter.remove(sessionId);
    this.clientBySession.delete(sessionId);
  }

  /** Запись рекорда и статистики матча; ошибки логируются, не рвут disconnect. */
  private async persistPublicMatchStats(
    meta: SessionMeta,
    st: SessionStats,
    bestR: number,
    timeSec: number,
  ): Promise<void> {
    const results = await Promise.allSettled([
      submitScore(meta.userId, meta.name, bestR),
      recordMatchEnd(meta.userId, meta.guest, {
        kills: st.kills,
        deaths: st.deaths,
        bestRadius: bestR,
        timeSec,
      }),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error(
          `[ArenaRoom] не удалось сохранить результат матча user=${meta.userId} name=${meta.name}:`,
          r.reason,
        );
      }
    }
  }

  private countHumanOwners(): number {
    const owners = new Set<string>();
    for (const ps of this.state.players.values()) {
      if (!ps.isBot) owners.add(playerOwnerKey(ps.id));
    }
    return owners.size;
  }

  private estimateRank(radius: number): number {
    const grouped = new Map<string, number>();
    for (const ps of this.state.players.values()) {
      if (ps.isBot) continue;
      const key = playerOwnerKey(ps.id);
      grouped.set(key, (grouped.get(key) ?? 0) + massFromRadius(ps.radius));
    }
    const scores = [...grouped.values()]
      .map((m) => radiusFromMass(m))
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
    this.botAI.registerBot(id, index);
  }

  private tick(dtMs: number): void {
    const dt = Math.min(dtMs / 1000, TICK_DT * 2);
    const nowMs = Date.now();
    this.state.serverTime = nowMs;

    // Серверный таймер матча.
    if (this.matchActive && this.state.matchEndsAt > 0 && nowMs >= this.state.matchEndsAt) {
      this.finishMatchByTimer();
      return;
    }

    if (!this.matchActive) {
      // После окончания: просто слегка обновляем позиции (затухание), без AI/еды.
      this.physics.step(dt);
      this.syncPlayers(nowMs);
      return;
    }

    const getTargetForBot = (botId: string): { id: string; radius: number } | null => {
      const ps = this.state.players.get(botId);
      if (!ps || !ps.targetId) return null;
      const tps = this.state.players.get(ps.targetId);
      if (!tps) return null;
      return { id: tps.id, radius: tps.radius };
    };
    for (const botId of this.botIds) {
      if (!this.state.players.has(botId)) continue;
      this.physics.setInput(
        botId,
        this.botAI.decide(
          botId,
          this.physics,
          this.pelletData,
          Date.now(),
          this.invuln,
          dt,
          getTargetForBot,
          this.hedgehogs.getAll(),
        ),
      );
    }

    applySplitRejoinPull(this.physics, this.sessionParts, dt);
    this.physics.step(dt);
    applyBoostMassDrain(this.physics, this.sessionParts, dt);

    const mergeEvents = resolveSplitMerges(
      this.physics,
      this.state,
      this.sessionParts,
      this.splitContactSince,
      nowMs,
    );
    for (const m of mergeEvents) {
      clearSplitContactForPart(this.splitContactSince, m.removedId);
      this.targetSystem.onPlayerRemoved(m.removedId, this.state, nowMs, this.invuln);
      const st = this.sessionStats.get(m.sessionId);
      if (st) st.bestRadius = Math.max(st.bestRadius, m.newRadius);
    }
    this.nudgeStuckBots();
    enforceSpeedLimits(this.physics.getAllPlayers());
    const now = nowMs;

    this.hedgehogs.step(dt);
    const hedgehogHits = this.hedgehogs.checkCollisions(
      this.physics,
      this.invuln,
      now,
    );
    let pelletsDirty = false;
    for (const hit of hedgehogHits) {
      if (this.shatterPlayerOnHedgehog(hit, now)) pelletsDirty = true;
    }

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
      pelletsDirty = true;
      const killerSession = this.findSessionByPart(e.eaterId);
      if (killerSession) {
        const st = this.sessionStats.get(killerSession);
        if (st) st.bestRadius = Math.max(st.bestRadius, e.newRadius);
      }
    }

    for (const e of events.playerEaten) {
      clearSplitContactForPart(this.splitContactSince, e.victimId);
      PelletUtil.scatterDeathLoot(
        e.victimX,
        e.victimZ,
        e.victimRadius,
        e.scatterMass,
        this.pelletData,
      );
      pelletsDirty = true;
      this.broadcastKill(e.killerName, e.victimName, now);

      // Цели: убитого как цель убрать у всех, у кого она стояла; убийце — новую цель.
      this.targetSystem.onPlayerEaten(
        e.eaterId,
        e.victimId,
        this.state,
        now,
        this.invuln,
      );

      const killerSession = this.findSessionByPart(e.eaterId);
      const victimSession = this.findSessionByPart(e.victimOwnerId);
      if (killerSession) {
        const st = this.sessionStats.get(killerSession);
        if (st) {
          st.kills += 1;
          st.bestRadius = Math.max(st.bestRadius, e.newRadius);
        }
        // Уведомим клиента о бонусе — пусть отрисует «toast» x3.
        if (e.wasTargetKill) {
          try {
            this.getClientBySession(killerSession)?.send("target_bonus", {
              victimName: e.victimName,
              mult: 3,
            });
          } catch {
            /* клиент мог отвалиться */
          }
        }
      }
      if (victimSession) {
        const st = this.sessionStats.get(victimSession);
        if (st) st.deaths += 1;
      }
    }

    // Респавн жертв создаёт новые playerId — выдадим им цели и обновим тех, чей target пропал.
    for (const r of events.respawns) {
      this.targetSystem.onPlayerSpawned(r.playerId, this.state, now, this.invuln);
    }

    // Периодически перевыбираем устаревшие цели у всех живых.
    this.targetSystem.tick(this.state, now, this.invuln);

    this.syncPlayers(now);
    if (pelletsDirty) this.syncPellets();
    this.syncHedgehogs(now);
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

  private broadcastKill(killerName: string, victimName: string, at: number): void {
    const msg: KillFeedEntry = {
      killerName,
      victimName,
      at,
      seq: ++this.killFeedSeq,
    };
    this.broadcast("kill", msg);
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
      const speed = Math.hypot(v.x, v.z);
      ps.braking =
        !!body.input.brake && speed >= 0.9;
    }
  }

  private syncPellets(): void {
    const live = this.pelletData;
    const arr = this.state.pellets;
    // swap-pop вместо splice — меньше refCount warnings в @colyseus/schema
    let i = 0;
    while (i < arr.length) {
      const row = arr[i];
      if (row && live.has(row.id)) {
        i++;
        continue;
      }
      const last = arr.length - 1;
      if (i < last) {
        const tail = arr[last];
        if (row && tail) {
          row.id = tail.id;
          row.x = tail.x;
          row.y = tail.y;
          row.z = tail.z;
          row.kind = tail.kind;
        }
      }
      arr.pop();
    }
    const byId = new Map<string, PelletState>();
    for (let j = 0; j < arr.length; j++) {
      const row = arr[j];
      if (row?.id) byId.set(row.id, row);
    }
    for (const p of live.values()) {
      let s = byId.get(p.id);
      if (!s) {
        s = new PelletState();
        s.id = p.id;
        arr.push(s);
        byId.set(p.id, s);
      }
      s.x = p.x;
      s.y = p.y;
      s.z = p.z;
      s.kind = p.kind;
    }
  }

  /**
   * Столкновение с ежом: рассыпается шар игрока/бота, еж продолжает катиться.
   */
  private shatterPlayerOnHedgehog(hit: HedgehogVictimHit, now: number): boolean {
    const victim = this.physics.getPlayer(hit.victimId);
    if (!victim) return false;
    if ((this.invuln.get(hit.victimId) ?? 0) > now) return false;

    const vPos = victim.body.translation();
    const victimMass = massFromRadius(victim.radius);
    const scatterMass = victimMass * DEATH_SCATTER_FRACTION;

    const victimPs = this.state.players.get(hit.victimId);
    const victimName = victimPs?.name ?? hit.victimId;
    const victimColor = victimPs?.color ?? 0xffffff;
    const victimSkin = victimPs?.skinId ?? "emoji_grin";
    const victimIsBot = victimPs?.isBot ?? false;

    PelletUtil.scatterDeathLoot(
      vPos.x,
      vPos.z,
      victim.radius,
      scatterMass,
      this.pelletData,
    );
    this.broadcastKill("Ёж-шар", victimName, now);

    const ownerId = victim.ownerId;
    const parts = this.sessionParts.get(ownerId);
    const partList = parts ?? [hit.victimId];
    const removedPartOnly = partList.length > 1;

    if (parts) {
      const partIdx = parts.indexOf(hit.victimId);
      if (partIdx >= 0) parts.splice(partIdx, 1);
    }

    clearSplitContactForPart(this.splitContactSince, hit.victimId);
    this.physics.removePlayer(hit.victimId);
    this.state.players.delete(hit.victimId);
    this.invuln.delete(hit.victimId);
    this.targetSystem.onPlayerRemoved(hit.victimId, this.state, now, this.invuln);

    if (removedPartOnly) {
      return true;
    }

    const margin = 3;
    const rx = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    const rz = (Math.random() * 2 - 1) * (ARENA_HALF - margin);
    const respawnId = ownerId;
    this.physics.addPlayer(respawnId, MIN_RADIUS, rx, rz, ownerId);
    if (parts) {
      parts.length = 0;
      parts.push(respawnId);
    }

    const row = new PlayerState();
    row.id = respawnId;
    row.name = victimName;
    row.color = victimColor;
    row.skinId = victimSkin;
    row.isBot = victimIsBot;
    row.radius = MIN_RADIUS;
    row.x = rx;
    row.z = rz;
    this.state.players.set(respawnId, row);

    this.invuln.set(respawnId, now + RESPAWN_INVULN_MS);
    this.targetSystem.onPlayerSpawned(respawnId, this.state, now, this.invuln);

    const victimSession = this.findSessionByPart(ownerId);
    if (victimSession) {
      const st = this.sessionStats.get(victimSession);
      if (st) st.deaths += 1;
    }

    return true;
  }

  private syncHedgehogs(nowMs = Date.now()): void {
    const all = this.hedgehogs.getAll();
    const arr = this.state.hedgehogs;
    const liveIds = new Set<string>();
    for (const h of all) liveIds.add(h.id);
    for (let i = arr.length - 1; i >= 0; i--) {
      const row = arr[i];
      if (row && !liveIds.has(row.id)) arr.splice(i, 1);
    }
    for (const h of all) {
      let s: HedgehogState | undefined;
      for (let i = 0; i < arr.length; i++) {
        const row = arr[i];
        if (row && row.id === h.id) {
          s = row;
          break;
        }
      }
      if (!s) {
        s = new HedgehogState();
        s.id = h.id;
        arr.push(s);
      }
      s.x = h.x;
      s.y = GROUND_Y + h.radius;
      s.z = h.z;
      s.radius = h.radius;
      const q = HedgehogManager.visualRotation(h, nowMs);
      s.qx = q.qx;
      s.qy = q.qy;
      s.qz = q.qz;
      s.qw = q.qw;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
