import type { Room } from "colyseus.js";
import { RoomPing } from "./roomPing.js";

const byRoom = new WeakMap<Room, RoomPing>();

export function attachRoomPing(room: Room): void {
  let p = byRoom.get(room);
  if (!p) {
    p = new RoomPing();
    byRoom.set(room, p);
  }
  p.attach(room);
}

export function detachRoomPing(room?: Room | null): void {
  if (room) {
    byRoom.get(room)?.detach();
    return;
  }
}

export function tickRoomPing(room: Room, nowMs = Date.now()): void {
  byRoom.get(room)?.tick(nowMs);
}

export function getRoomPing(room: Room): number {
  const conn = room.connection as { rtt?: number; latency?: number } | undefined;
  const native = conn?.rtt ?? conn?.latency ?? 0;
  if (native > 0) return native;
  return byRoom.get(room)?.get() ?? 0;
}
