import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ArenaRoom } from "./rooms/ArenaRoom.js";
import { PrivateArenaRoom } from "./rooms/PrivateArenaRoom.js";
import { mountApiRoutes } from "./api/routes.js";
import { migrate } from "./db/migrate.js";

const PORT = Number(process.env.COLYSEUS_PORT ?? 2567);

async function main(): Promise<void> {
  await migrate();

  const app = express();
  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  app.use(
    cors(
      corsOrigin
        ? { origin: corsOrigin.split(",").map((s) => s.trim()), credentials: true }
        : undefined,
    ),
  );
  app.use(express.json());

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define("arena", ArenaRoom);
  gameServer.define("private_arena", PrivateArenaRoom).filterBy(["code"]);

  mountApiRoutes(app);
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "sphere3d-server", phase: 2 });
  });

  httpServer.listen(PORT, () => {
    console.log(`[Sphere3D] Colyseus на порту ${PORT}`);
  });
}

main().catch((e) => {
  console.error("[Sphere3D] Фатальная ошибка:", e);
  process.exit(1);
});
