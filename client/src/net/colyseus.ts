import { Client, Room } from "colyseus.js";
import { MATCH_REUSE_MIN_REMAINING_MS } from "@spherio/shared";
import type { JoinOptions } from "@spherio/shared";

const RECONNECT_KEY = "sphere3d_reconnect";

interface ArenaRoomMeta {
  private?: boolean;
  matchEndsAt?: number;
  matchStartedAt?: number;
  matchPhase?: string;
  humanCount?: number;
  maxClients?: number;
}

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
  // Сначала ищем существующее публичное лобби, в котором:
  //  - есть свободное место (clients < maxClients);
  //  - матч ещё активен и до конца более MATCH_REUSE_MIN_REMAINING_MS.
  try {
    const rooms = await c.getAvailableRooms("arena");
    const now = Date.now();
    const candidates = rooms
      .filter((r) => {
        if (r.clients >= r.maxClients) return false;
        const meta = (r.metadata ?? {}) as ArenaRoomMeta;
        if (meta.private) return false;
        if (meta.matchPhase && meta.matchPhase !== "running") return false;
        const endsAt = meta.matchEndsAt ?? 0;
        if (!endsAt) return false;
        return endsAt - now >= MATCH_REUSE_MIN_REMAINING_MS;
      })
      .sort((a, b) => {
        // Выбираем самую населённую из подходящих — лучше попасть в живую сессию.
        if (b.clients !== a.clients) return b.clients - a.clients;
        const ae = ((a.metadata ?? {}) as ArenaRoomMeta).matchEndsAt ?? 0;
        const be = ((b.metadata ?? {}) as ArenaRoomMeta).matchEndsAt ?? 0;
        return be - ae;
      });
    if (candidates.length > 0) {
      try {
        const room = await c.joinById(candidates[0].roomId, opts);
        saveReconnectToken(room);
        return room;
      } catch (err) {
        console.warn("[matchmake] joinById не сработал, fallback", err);
      }
    }
  } catch (err) {
    console.warn("[matchmake] getAvailableRooms не сработал", err);
  }

  // Иначе — создаём новую публичную комнату.
  const room = await c.create("arena", opts);
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
