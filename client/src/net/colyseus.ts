import { Client, Room } from "colyseus.js";
import type { JoinOptions } from "@spherio/shared";

function endpoint(): string {
  const env = import.meta.env.VITE_COLYSEUS_ENDPOINT as string | undefined;
  if (env) return env;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${proto}//${host}/colyseus`;
}

let client: Client | null = null;

export function getClient(): Client {
  if (!client) client = new Client(endpoint());
  return client;
}

export async function joinArena(name: string): Promise<Room> {
  const c = getClient();
  return c.joinOrCreate("arena", { name } satisfies JoinOptions);
}

export function getPing(room: Room): number {
  const conn = room.connection as { rtt?: number; latency?: number } | undefined;
  return conn?.rtt ?? conn?.latency ?? 0;
}
