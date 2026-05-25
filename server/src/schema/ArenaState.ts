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
}
