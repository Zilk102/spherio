import type { Express, Request } from "express";
import type {
  AddFriendRequest,
  CreateLobbyRequest,
  GuestAuthRequest,
  LoginRequest,
  PatchProfileRequest,
  RefreshRequest,
  RegisterRequest,
  ResendVerificationRequest,
  ShopBuyRequest,
} from "@spherio/shared";
import {
  createGuest,
  getProfile,
  login,
  patchProfile,
  refreshAuth,
  register,
  resendVerificationEmail,
  verifyEmail,
  verifyToken,
} from "../services/auth.js";
import { addFriend, listFriends } from "../services/friends.js";
import { getLeaderboard, submitScore } from "../services/leaderboard.js";
import { createPrivateLobby, getLobbyInfo } from "../services/lobby.js";
import { buySkin } from "../services/shop.js";

function bearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function mountApiRoutes(app: Express): void {
  app.use("/api", (req, res, next) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    next();
  });

  app.post("/api/auth/guest", (req, res) => {
    const body = req.body as GuestAuthRequest;
    res.json(createGuest(body ?? {}));
  });

  app.post("/api/auth/refresh", async (req, res) => {
    const body = req.body as RefreshRequest;
    const auth = await refreshAuth(body?.refreshToken ?? "");
    if (!auth) {
      res.status(401).json({ error: "invalid_refresh" });
      return;
    }
    res.json(auth);
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const body = req.body as RegisterRequest;
      res.json(await register(body ?? ({} as RegisterRequest)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (msg === "invalid_credentials") {
        res.status(400).json({ error: "invalid_credentials" });
        return;
      }
      if (msg === "smtp_not_configured") {
        res.status(503).json({ error: "smtp_not_configured" });
        return;
      }
      if (code === "23505") {
        res.status(409).json({ error: "email_taken" });
        return;
      }
      console.error("[API] auth/register", e);
      res.status(500).json({ error: "register_failed" });
    }
  });

  app.get("/api/auth/verify-email", async (req, res) => {
    try {
      const token = String(req.query.token ?? "");
      res.json(await verifyEmail(token));
    } catch (e) {
      console.error("[API] auth/verify-email", e);
      res.status(500).json({ ok: false, error: "verify_failed" });
    }
  });

  app.post("/api/auth/resend-verification", async (req, res) => {
    try {
      const body = req.body as ResendVerificationRequest;
      res.json(await resendVerificationEmail(body?.email ?? ""));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_credentials") {
        res.status(400).json({ error: "invalid_credentials" });
        return;
      }
      if (msg === "smtp_not_configured") {
        res.status(503).json({ error: "smtp_not_configured" });
        return;
      }
      console.error("[API] auth/resend-verification", e);
      res.status(500).json({ error: "resend_failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const body = req.body as LoginRequest;
      const auth = await login(body ?? ({} as LoginRequest));
      if (!auth) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      res.json(auth);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "email_not_verified") {
        res.status(403).json({ error: "email_not_verified" });
        return;
      }
      console.error("[API] auth/login", e);
      res.status(500).json({ error: "login_failed" });
    }
  });

  app.get("/api/profile", async (req, res) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const verified = verifyToken(token);
    if (!verified) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const profile = await getProfile(verified.userId, verified.guest);
    if (!profile) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    res.json(profile);
  });

  app.patch("/api/profile", async (req, res) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const verified = verifyToken(token);
    if (!verified) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const profile = await patchProfile(
      verified.userId,
      verified.guest,
      req.body as PatchProfileRequest,
    );
    if (!profile) {
      res.status(400).json({ error: "invalid_profile" });
      return;
    }
    res.json(profile);
  });

  app.post("/api/lobby/create", async (req, res) => {
    try {
      const body = req.body as CreateLobbyRequest;
      const max = Math.min(32, Math.max(2, body.maxClients ?? 16));
      const enableBots = !!body.enableBots;
      const lobby = await createPrivateLobby(max, enableBots);
      res.json(lobby);
    } catch (e) {
      console.error("[API] lobby/create", e);
      res.status(500).json({ error: "lobby_create_failed" });
    }
  });

  app.get("/api/lobby/:code", async (req, res) => {
    try {
      const code = String(req.params.code ?? "").toUpperCase();
      const info = await getLobbyInfo(code);
      res.json({
        code,
        exists: info.exists,
        clients: info.clients,
        maxClients: info.maxClients,
        enableBots: info.enableBots,
      });
    } catch (e) {
      console.error("[API] lobby/get", e);
      res.status(500).json({ error: "lobby_lookup_failed" });
    }
  });

  app.get("/api/friends", async (req, res) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const verified = verifyToken(token);
    if (!verified) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const friends = await listFriends(verified.userId);
    res.json({ userId: verified.userId, friends });
  });

  app.post("/api/friends/add", async (req, res) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const verified = verifyToken(token);
    if (!verified) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const friendUserId = String((req.body as AddFriendRequest).friendUserId ?? "").trim();
    if (!(await addFriend(verified.userId, friendUserId))) {
      res.status(400).json({ error: "invalid_friend" });
      return;
    }
    const friends = await listFriends(verified.userId);
    res.json({ ok: true, friends });
  });

  app.post("/api/shop/buy", async (req, res) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const verified = verifyToken(token);
    if (!verified) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const skinId = String((req.body as ShopBuyRequest).skinId ?? "");
    const result = await buySkin(verified.userId, verified.guest, skinId);
    if (!result) {
      res.status(400).json({ error: "cannot_buy" });
      return;
    }
    res.json(result);
  });

  app.get("/api/leaderboard", async (req, res) => {
    const period = req.query.period === "daily" ? "daily" : "all";
    const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 20));
    res.json(await getLeaderboard(period, limit));
  });

  app.post("/api/leaderboard/submit", async (req, res) => {
    const { userId, displayName, radius } = req.body as {
      userId?: string;
      displayName?: string;
      radius?: number;
    };
    if (!userId || !displayName || typeof radius !== "number") {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    await submitScore(userId, displayName, radius);
    res.json({ ok: true });
  });
}
