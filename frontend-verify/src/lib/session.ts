// Persists the authenticated session (JWT + user summary) in localStorage so it
// survives reloads. This is intentionally small — a real app would add refresh
// and expiry handling, but the backend issues a single signed JWT per login.

import type { AuthResult, AuthUser } from './api';

const TOKEN_KEY = 'vibenet:auth:token';
const USER_KEY = 'vibenet:auth:user';

export function saveSession(result: AuthResult): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, result.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(result.user));
}

// saveUser replaces the stored user record without touching the token — used
// when the profile is refreshed from GET /api/user/me or edited in settings.
export function saveUser(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}
