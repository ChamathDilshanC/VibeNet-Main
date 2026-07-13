// Authenticated calls for the signed-in user's own profile.
//
// The JWT only carries `user_id` and `username`, so anything that can change
// after the token was issued — the Google `avatar_url`, or a username edited in
// settings — has to come from the server. Both calls return the backend's
// `userSummary`, which is the same shape as `AuthUser`.

import { API_BASE_URL, ApiError, type AuthUser } from './api';
import { apiClient } from './apiClient';
import { getToken } from './session';

// GET /api/user/me — the authenticated user's current profile.
export function fetchMe(): Promise<AuthUser> {
  return apiClient.get<AuthUser>('/api/user/me');
}

// PUT /api/user/profile — updates the account's username and display name (real
// name). Rejects with an ApiError carrying status 409 when another account
// already holds the username. A blank display name is defaulted to the username
// server-side.
export function updateProfile(username: string, displayName: string): Promise<AuthUser> {
  return apiClient.put<AuthUser>('/api/user/profile', {
    username,
    display_name: displayName,
  });
}

// POST /api/user/deactivate — flips the account to "deactivated": it can no longer
// sign in anywhere, but the profile and message history keep showing normally to
// peers (with a "Deactivated" badge). Reversible by a future reactivation path; the
// caller is responsible for clearing the local session and redirecting to /login.
export function deactivateAccount(): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>('/api/user/deactivate');
}

// DELETE /api/user/delete — permanently disables the account and wipes its PII
// (real name, email, phone, avatar) server-side. Past messages remain in DynamoDB
// but peers resolve them to "Deleted User" once they see the deleted status. There
// is no undo; the caller is responsible for clearing the local session and
// redirecting to /login.
export function deleteAccount(): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>('/api/user/delete');
}

// Chat-PIN status returned by GET /api/user/my-pin and PUT /api/user/settings/pin.
// `pin` is the code the owner should share right now (the static custom PIN, or the
// active rotating code); empty when disabled, or when static is chosen without a PIN
// set yet. `expires_at` is present only for rotating codes.
export interface PinStatus {
  enabled: boolean;
  type: 'rotating' | 'static';
  pin: string;
  expires_at?: string;
}

// GET /api/user/my-pin — the owner's current chat-PIN status and shareable code.
export function fetchMyPin(): Promise<PinStatus> {
  return apiClient.get<PinStatus>('/api/user/my-pin');
}

// POST /api/user/verify-pin — validates the PIN the current user entered to unlock
// their own chat interface, against their own active PIN (static or rotating).
// Resolves on success; rejects with an ApiError (status 403) on a wrong PIN.
export function verifyPin(pin: string): Promise<{ valid: boolean }> {
  return apiClient.post<{ valid: boolean }>('/api/user/verify-pin', { pin });
}

// POST /api/users/{id}/verify-pin — validates the PIN entered to START a chat with
// a target recipient, against THAT recipient's active PIN (their anti-spam gate).
// Unlike verifyPin (which checks the caller's own PIN), this is the check that
// gates initiating contact with a PIN-protected user. Resolves on success; rejects
// with an ApiError (status 403) on a wrong PIN.
export function verifyPeerPin(peerId: string, pin: string): Promise<{ valid: boolean }> {
  return apiClient.post<{ valid: boolean }>(
    `/api/users/${encodeURIComponent(peerId)}/verify-pin`,
    { pin },
  );
}

// PUT /api/user/settings/pin — persists the chat-PIN configuration. `customPin` is
// only sent for the static type; omit it to keep a previously-set custom PIN.
export function updatePinSettings(input: {
  enabled: boolean;
  type: 'rotating' | 'static';
  customPin?: string;
}): Promise<PinStatus> {
  return apiClient.put<PinStatus>('/api/user/settings/pin', {
    enabled: input.enabled,
    type: input.type,
    ...(input.customPin !== undefined ? { custom_pin: input.customPin } : {}),
  });
}

// POST /api/user/avatar — uploads a new profile picture as multipart/form-data and
// returns the updated profile (with the new absolute avatar_url). The backend also
// broadcasts a user_update so peers refresh the picture live.
//
// This bypasses apiClient because that helper forces a JSON Content-Type; for a
// multipart body the browser must set Content-Type itself (with the boundary), so
// we call fetch directly and attach the bearer token by hand.
export async function uploadAvatar(file: File): Promise<AuthUser> {
  const token = getToken();
  const form = new FormData();
  form.append('avatar', file);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/user/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // No/!JSON body; fall through to status handling.
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Upload failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as AuthUser;
}
