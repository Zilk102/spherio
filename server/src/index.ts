import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "colyseus";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

const PORT = Number(process.env.COLYSEUS_PORT ?? 2567);

async function main(): Promise<void> {
  const app = express();
  app.use(cors());
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "spherio-server" });
  });

  const httpServer = createServer(app);
  const gameServer = new Server({ server: httpServer });
  gameServer.define("arena", ArenaRoom);

  httpServer.listen(PORT, () => {
    console.log(`[Spherio] Colyseus на порту ${PORT}`);
  });
}

main().catch((e) => {
  console.error("[Spherio] Фатальная ошибка:", e);
  process.exit(1);
});
