import { Client, Room } from "colyseus.js";
import type { JoinOptions } from "@spherio/shared";

const RECONNECT_KEY = "sphere3d_reconnect";

function endpoint(): string {
  const env = import.meta.env.VITE_COLYSEUS_ENDPOINT as string | undefined;
  if (env) return env;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/colyseus`;
}

let client: Client | null = null;

export function getClient(): Client {
  if (!client) client = new Client(endpoint());
  return client;
}

export function saveReconnectToken(room: Room): void {
  if (room.reconnectionToken) {
    sessionStorage.setItem(RECONNECT_KEY, room.reconnectionToken);
  }
}

export function clearReconnectToken(): void {
  sessionStorage.removeItem(RECONNECT_KEY);
}

export async function tryReconnect(): Promise<Room | null> {
  const token = sessionStorage.getItem(RECONNECT_KEY);
  if (!token) return null;
  try {
    const c = getClient();
    const room = await c.reconnect(token);
    saveReconnectToken(room);
    return room;
  } catch {
    clearReconnectToken();
    return null;
  }
}

export async function joinPublicArena(opts: JoinOptions): Promise<Room> {
  const c = getClient();
  const room = await c.joinOrCreate("arena", opts);
  saveReconnectToken(room);
  return room;
}

export async function joinPrivateArena(opts: JoinOptions): Promise<Room> {
  const c = getClient();
  if (!opts.code) throw new Error("Нужен код лобби");
  const room = await c.join("private_arena", opts);
  saveReconnectToken(room);
  return room;
}

export function getPing(room: Room): number {
  const conn = room.connection as { rtt?: number; latency?: number } | undefined;
  return conn?.rtt ?? conn?.latency ?? 0;
}
