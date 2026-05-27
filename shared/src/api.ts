/** POST /api/auth/guest */
export interface GuestAuthRequest {
  displayName?: string;
  guestUserId?: string;
}

/** POST /api/auth/register */
export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
  guestUserId?: string;
}

/** POST /api/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
  guestUserId?: string;
}

/** POST /api/auth/refresh */
export interface RefreshRequest {
  refreshToken: string;
}

export interface UserStats {
  gamesPlayed: number;
  kills: number;
  deaths: number;
  bestScore: number;
  totalTimeSec: number;
  coins: number;
}

/** GET /api/profile */
export interface ProfileResponse {
  userId: string;
  displayName: string;
  equippedSkinId: string;
  ownedSkinIds: string[];
  guest: boolean;
  email?: string;
  emailVerified?: boolean;
  stats: UserStats;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  userId: string;
  displayName: string;
  equippedSkinId: string;
  ownedSkinIds: string[];
}

/** POST /api/auth/register — аккаунт создан, нужно подтвердить почту. */
export interface RegisterPendingResponse {
  ok: true;
  email: string;
  message: string;
}

export interface VerifyEmailResponse {
  ok: boolean;
  error?: "invalid_token" | "expired" | "already_verified";
}

export interface ResendVerificationRequest {
  email: string;
}

export interface ResendVerificationResponse {
  ok: true;
  message: string;
}

/** PATCH /api/profile */
export interface PatchProfileRequest {
  displayName?: string;
  equippedSkinId?: string;
}

/** POST /api/lobby/create */
export interface CreateLobbyRequest {
  displayName?: string;
  maxClients?: number;
  enableBots?: boolean;
}

export interface CreateLobbyResponse {
  code: string;
  roomId: string;
  roomName: "private_arena";
  maxClients: number;
  enableBots: boolean;
}

/** GET /api/lobby/:code */
export interface LobbyInfoResponse {
  code: string;
  exists: boolean;
  clients: number;
  maxClients: number;
  enableBots?: boolean;
}

/** GET /api/leaderboard?limit=20&period=all|daily */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
}

export interface LeaderboardResponse {
  period: "all" | "daily";
  entries: LeaderboardEntry[];
}

/** GET /api/friends */
export interface FriendEntry {
  userId: string;
  displayName: string;
}

export interface FriendsListResponse {
  userId: string;
  friends: FriendEntry[];
}

/** POST /api/friends/add */
export interface AddFriendRequest {
  friendUserId: string;
}

/** POST /api/shop/buy */
export interface ShopBuyRequest {
  skinId: string;
}

export interface ShopBuyResponse {
  ok: boolean;
  ownedSkinIds: string[];
  coins: number;
}
