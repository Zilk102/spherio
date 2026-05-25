import type {
  AuthResponse,
  CreateLobbyRequest,
  CreateLobbyResponse,
  FriendsListResponse,
  GuestAuthRequest,
  LeaderboardResponse,
  LobbyInfoResponse,
  LoginRequest,
  PatchProfileRequest,
  ProfileResponse,
  RefreshRequest,
  RegisterRequest,
  ShopBuyRequest,
  ShopBuyResponse,
} from "@spherio/shared";
import { getToken } from "../lib/session.js";

function apiBase(): string {
  const env = import.meta.env.VITE_API_BASE as string | undefined;
  if (env) return env.replace(/\/$/, "");
  return "";
}

function authHeaders(token?: string | null): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = token ?? getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function post<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: authHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `API ${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function authGuest(req: GuestAuthRequest = {}): Promise<AuthResponse> {
  return post("/api/auth/guest", req);
}

export async function authRefresh(req: RefreshRequest): Promise<AuthResponse> {
  return post("/api/auth/refresh", req);
}

export async function authRegister(req: RegisterRequest): Promise<AuthResponse> {
  return post("/api/auth/register", req);
}

export async function authLogin(req: LoginRequest): Promise<AuthResponse> {
  return post("/api/auth/login", req);
}

export async function fetchProfile(token?: string): Promise<ProfileResponse> {
  return get("/api/profile", token);
}

export async function patchProfile(
  body: PatchProfileRequest,
  token?: string,
): Promise<ProfileResponse> {
  return patch("/api/profile", body, token);
}

export async function createLobby(body: CreateLobbyRequest = {}): Promise<CreateLobbyResponse> {
  return post("/api/lobby/create", body);
}

export async function fetchLobbyInfo(code: string): Promise<LobbyInfoResponse> {
  return get(`/api/lobby/${encodeURIComponent(code.toUpperCase())}`);
}

export async function fetchLeaderboard(
  period: "all" | "daily" = "all",
  limit = 15,
): Promise<LeaderboardResponse> {
  return get(`/api/leaderboard?period=${period}&limit=${limit}`);
}

export async function fetchFriends(token?: string): Promise<FriendsListResponse> {
  return get("/api/friends", token);
}

export async function addFriend(friendUserId: string, token?: string): Promise<FriendsListResponse> {
  return post("/api/friends/add", { friendUserId }, token);
}

export async function buySkin(skinId: string, token?: string): Promise<ShopBuyResponse> {
  return post("/api/shop/buy", { skinId } satisfies ShopBuyRequest, token);
}
