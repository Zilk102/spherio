import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0.5;
  @type("number") z = 0;
  @type("number") vx = 0;
  @type("number") vz = 0;
  @type("number") qx = 0;
  @type("number") qy = 0;
  @type("number") qz = 0;
  @type("number") qw = 1;
  @type("number") radius = 0.5;
  @type("string") name = "";
  @type("number") color = 0xffffff;
  @type("string") skinId = "emoji_grin";
  @type("number") invulnUntil = 0;
  @type("boolean") isBot = false;
  /** id текущей «цели» (другого игрока/бота). "" — нет цели. */
  @type("string") targetId = "";
  /** Серверное время, когда цель «протухнет» и будет перевыбрана. */
  @type("number") targetExpiresAt = 0;
  /** true — игрок жмёт тормоз и едет достаточно быстро (для следов на клиенте). */
  @type("boolean") braking = false;
}

export class PelletState extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0.15;
  @type("number") z = 0;
}

export class KillFeedEntryState extends Schema {
  @type("string") killerName = "";
  @type("string") victimName = "";
  @type("number") at = 0;
}

export class ArenaState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([PelletState]) pellets = new ArraySchema<PelletState>();
  @type([KillFeedEntryState]) killFeed = new ArraySchema<KillFeedEntryState>();
  /** Серверное время старта матча (ms epoch). 0 — не запущен. */
  @type("number") matchStartedAt = 0;
  /** Серверное время окончания матча (ms epoch). 0 — не запланирован. */
  @type("number") matchEndsAt = 0;
  /** "waiting" — ждём 2+ человек (private), "running" — матч идёт, "ended" — финал. */
  @type("string") matchPhase = "waiting";
  /** True если эта комната приватная (по коду). Клиент не пишет очки в глобальный топ. */
  @type("boolean") isPrivate = false;
}
