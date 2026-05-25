import { matchMaker } from "@colyseus/core";
import type { CreateLobbyResponse } from "@spherio/shared";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateLobbyCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

export async function createPrivateLobby(
  maxClients = 16,
  enableBots = false,
): Promise<CreateLobbyResponse> {
  const code = generateLobbyCode();
  const room = await matchMaker.createRoom("private_arena", {
    code,
    maxClients,
    enableBots,
  });
  return {
    code,
    roomId: room.roomId,
    roomName: "private_arena",
    maxClients,
    enableBots,
  };
}

export async function getLobbyInfo(code: string): Promise<{
  exists: boolean;
  clients: number;
  maxClients: number;
  enableBots: boolean;
}> {
  const rooms = await matchMaker.query({ name: "private_arena" });
  const normalized = code.toUpperCase();
  const room = rooms.find(
    (r) => (r.metadata as { code?: string })?.code === normalized,
  );
  if (!room) {
    return { exists: false, clients: 0, maxClients: 0, enableBots: false };
  }
  const meta = room.metadata as { enableBots?: boolean };
  return {
    exists: true,
    clients: room.clients,
    maxClients: room.maxClients,
    enableBots: !!meta.enableBots,
  };
}
