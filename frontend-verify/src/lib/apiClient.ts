// Authenticated fetch client for VibeNet REST endpoints.
//
// Wraps fetch with the API base URL and automatically attaches the stored
// JWT as a Bearer token, so authenticated calls (contacts, search, PIN
// settings, etc.) don't have to thread the token through by hand. Requests
// made while signed out simply omit the header.

import { API_BASE_URL, ApiError } from './api';
import { getToken } from './session';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // No JSON body (e.g. a 204, or a proxy error page); fall through to status handling.
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
