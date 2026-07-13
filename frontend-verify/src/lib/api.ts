// Thin client for the VibeNet backend REST API.
//
// The base URL is read from NEXT_PUBLIC_API_BASE_URL and falls back to the
// backend's local default (:8080). The backend's CORS allow-list already
// includes http://localhost:3000, so the dev front-end can call it directly.

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
).replace(/\/$/, '');

// resolveAvatarUrl turns a stored avatar reference into a loadable image URL.
//
// Uploaded avatars are backend-served under "/uploads/…". We always rebase
// those onto the configured API origin (API_BASE_URL) so they load from the
// backend regardless of how the reference was stored — whether it is a clean
// origin-relative path ("/uploads/avatars/x.jpg") or an absolute URL that was
// baked in against a now-dead host (e.g. "http://localhost:8080/uploads/…"
// left over from local dev or a stale build). Without this rebase such absolute
// URLs are handed straight to the browser and fail with ERR_CONNECTION_REFUSED.
//
// Genuinely external references — Google account photos (any other https host),
// local file previews (blob:), or inline data: URIs — are returned unchanged.
export function resolveAvatarUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^(?:blob:|data:)/i.test(url)) return url;

  // Absolute http(s) URL: only rebase it if it points at an uploads path;
  // otherwise it's an external image (e.g. a Google avatar) — leave it alone.
  if (/^https?:/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/uploads/')) {
        return `${API_BASE_URL}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // Malformed absolute URL — fall through and return it untouched below.
    }
    return url;
  }

  // Relative reference (the normal case for freshly uploaded avatars).
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

// Shape of the user object returned by the auth endpoints (see backend
// userSummary / authResponse in internal/api/handler.go).
export interface AuthUser {
  user_id: string;
  username: string;
  /** Human "real name" shown throughout the client in place of the username.
   *  The backend always returns it, falling back to the username when unset. */
  display_name: string;
  email?: string;
  phone_number?: string;
  public_key?: string;
  /** Google account photo, re-synced by the backend on each Google sign-in.
   *  Absent for password accounts, which render initials instead. */
  avatar_url?: string;
  /** Whether starting a chat with this account requires a PIN. Defaults on. */
  chat_pin_enabled?: boolean;
  /** How the required PIN is derived: a 5-minute rotating code or a static custom PIN. */
  chat_pin_type?: 'rotating' | 'static';
  /** Account lifecycle state. Absent on older cached sessions predating this field —
   *  treat as 'active'. */
  status?: UserStatus;
}

/** Account lifecycle state — see the backend's models.UserStatus* constants. */
export type UserStatus = 'active' | 'deactivated' | 'deleted';

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export interface RegisterInput {
  username: string;
  password: string;
  email: string;
  phoneNumber: string;
  publicKey: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

// ApiError carries the HTTP status plus the backend's { "error": "..." } message.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. a proxy error page); fall through to status handling.
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

// POST /api/auth/register — creates a password account with an E2EE public key.
export function register(input: RegisterInput): Promise<AuthResult> {
  return postJSON<AuthResult>('/api/auth/register', {
    username: input.username,
    password: input.password,
    email: input.email,
    phone_number: input.phoneNumber,
    public_key: input.publicKey,
  });
}

// POST /api/auth/login — authenticates a password account.
export function login(input: LoginInput): Promise<AuthResult> {
  return postJSON<AuthResult>('/api/auth/login', {
    username: input.username,
    password: input.password,
  });
}

// GET /api/auth/google/login — server redirects the browser to Google's consent screen.
export function googleLoginUrl(): string {
  return `${API_BASE_URL}/api/auth/google/login`;
}
