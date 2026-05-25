import type { AuthResponse } from "@spherio/shared";

const TOKEN_KEY = "sphere3d_token";
const AUTH_KEY = "sphere3d_auth";
const LEGACY_TOKEN_KEY = "spherio_token";
const LEGACY_AUTH_KEY = "spherio_auth";

export interface StoredAuth {
  auth: AuthResponse;
  guest: boolean;
}

function migrateStorage(): void {
  if (!localStorage.getItem(TOKEN_KEY) && localStorage.getItem(LEGACY_TOKEN_KEY)) {
    localStorage.setItem(TOKEN_KEY, localStorage.getItem(LEGACY_TOKEN_KEY)!);
  }
  if (!localStorage.getItem(AUTH_KEY) && localStorage.getItem(LEGACY_AUTH_KEY)) {
    localStorage.setItem(AUTH_KEY, localStorage.getItem(LEGACY_AUTH_KEY)!);
  }
}

export function saveAuth(auth: AuthResponse, guest = false): void {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(AUTH_KEY, JSON.stringify({ auth, guest } satisfies StoredAuth));
}

export function loadAuth(): StoredAuth | null {
  migrateStorage();
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredAuth | AuthResponse;
    if ("auth" in parsed && parsed.auth) return parsed as StoredAuth;
    return { auth: parsed as AuthResponse, guest: true };
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_AUTH_KEY);
}

export function getToken(): string | null {
  migrateStorage();
  return localStorage.getItem(TOKEN_KEY);
}
