// Group chat REST layer: types mirroring the backend DTOs (see the backend's
// internal/api/groups.go) plus thin apiClient wrappers.
//
// Group messages are E2EE under a per-group AES key. Each API shape that hands
// a group to its member carries THAT member's wrapped copy of the key
// (wrapped_key/key_nonce) and who wrapped it (wrapped_by) — the member's client
// derives the pairwise ECDH key with the wrapper and unwraps locally. See
// src/lib/e2ee.ts for the primitives; DashboardShell owns the unwrap cache.

import { API_BASE_URL, ApiError } from './api';
import { apiClient } from './apiClient';
import { getToken } from './session';

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  role: GroupRole;
}

// canManageGroup is the single source of truth for "may add members / change
// roles" — the owner and admins, never a regular member. Used to gate both
// the UI (Invite button, promote/demote actions) and mirrors the backend's
// requireGroupAdmin check, so the two never drift apart.
export function canManageGroup(role: GroupRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export interface Group {
  group_id: string;
  name: string;
  created_by: string;
  /** Unix ms. */
  created_at: number;
  /** Group photo, backend-relative like user avatars. Absent → name initials. */
  avatar_url?: string;
  members: GroupMember[];
  /** The current user's wrapped copy of the group key (base64 AES-GCM ciphertext). */
  wrapped_key: string;
  key_nonce: string;
  /** Whose public key pairs with ours to unwrap — the creator or our inviter. */
  wrapped_by: string;
}

export interface GroupInvite {
  invite_id: string;
  group_id: string;
  group_name: string;
  from_user_id: string;
  from_username: string;
  from_display_name: string;
  from_avatar_url?: string;
  /** Unix ms. */
  created_at: number;
}

/** One member's encrypted copy of the group key, produced client-side. */
export interface WrappedKeyInput {
  wrapped_key: string;
  key_nonce: string;
}

// groupRoomId derives the chat room id group history and frames use. The
// backend derives the same value from the frame's group_id, so a client can
// never write into a room it wasn't authorized for.
export function groupRoomId(groupId: string): string {
  return `group:${groupId}`;
}

// memberName mirrors peerName's fallback for group rosters: the display name
// when set, otherwise the username — so bubbles and typing labels never show
// an empty string. Unknown senders (roster not yet refreshed) get a stub.
export function memberName(group: Group, userId: string): string {
  const member = group.members.find((m) => m.user_id === userId);
  if (!member) return 'Unknown member';
  return member.display_name.trim() || member.username;
}

// GET /api/groups — every group the signed-in user belongs to.
export async function fetchGroups(): Promise<Group[]> {
  const data = await apiClient.get<{ groups: Group[] }>('/api/groups');
  return data.groups;
}

// POST /api/groups/create — creates the group with the caller as owner plus
// the directly-added members, each entry carrying the key wrapped for them.
export function createGroup(input: {
  name: string;
  selfKey: WrappedKeyInput;
  members: Array<{ user_id: string } & WrappedKeyInput>;
}): Promise<Group> {
  return apiClient.post<Group>('/api/groups/create', {
    name: input.name,
    self_key: input.selfKey,
    members: input.members,
  });
}

// POST /api/groups/{id}/members — adds a user by username to a group we own
// or admin, with the group key wrapped for them by this client. Backend
// enforces owner/admin only (403 for a regular member); lands as a pending
// invite the target must accept.
export function addGroupMember(input: {
  groupId: string;
  username: string;
  key: WrappedKeyInput;
}): Promise<{ invite_id: string; status: string }> {
  return apiClient.post<{ invite_id: string; status: string }>(
    `/api/groups/${encodeURIComponent(input.groupId)}/members`,
    {
      username: input.username,
      wrapped_key: input.key.wrapped_key,
      key_nonce: input.key.key_nonce,
    },
  );
}

// GET /api/invites — the signed-in user's pending group invitations.
export async function fetchInvites(): Promise<GroupInvite[]> {
  const data = await apiClient.get<{ invites: GroupInvite[] }>('/api/invites');
  return data.invites;
}

// POST /api/invites/accept — joins the group; returns it in full (roster +
// our wrapped key) so the client can open it immediately.
export function acceptInvite(inviteId: string): Promise<Group> {
  return apiClient.post<Group>('/api/invites/accept', { invite_id: inviteId });
}

// POST /api/invites/decline — dismisses a pending invite.
export function declineInvite(inviteId: string): Promise<{ status: string }> {
  return apiClient.post<{ status: string }>('/api/invites/decline', { invite_id: inviteId });
}

// PUT /api/groups/{id} — renames the group (any member may). Returns the
// updated group; other members are nudged live via a group_update frame.
export function renameGroup(groupId: string, name: string): Promise<Group> {
  return apiClient.put<Group>(`/api/groups/${encodeURIComponent(groupId)}`, { name });
}

// POST /api/groups/{id}/avatar — uploads a new group photo as
// multipart/form-data and returns the updated group.
//
// Bypasses apiClient for the same reason uploadAvatar in user.ts does: a
// multipart body needs the browser to set its own Content-Type boundary.
export async function uploadGroupAvatar(groupId: string, file: File): Promise<Group> {
  const token = getToken();
  const form = new FormData();
  form.append('avatar', file);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/groups/${encodeURIComponent(groupId)}/avatar`, {
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
    // No/non-JSON body; fall through to status handling.
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Upload failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as Group;
}

// PUT /api/groups/{id}/members/{userId}/role — promotes a member to admin or
// demotes an admin back to member. Owner-or-admin only; the owner's own role
// is immutable through this call. Returns the updated group so the roster's
// badges refresh immediately.
export function updateMemberRole(
  groupId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<Group> {
  return apiClient.put<Group>(
    `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/role`,
    { role },
  );
}

// POST /api/groups/{id}/leave — removes the caller from the group. If they
// were its last member the group is deleted server-side; if they were the
// owner, ownership passes to the earliest-joined remaining member.
export function leaveGroup(groupId: string): Promise<{ left: boolean }> {
  return apiClient.post<{ left: boolean }>(
    `/api/groups/${encodeURIComponent(groupId)}/leave`,
  );
}

// DELETE /api/groups/{id}/members/{userId} — removes another member. Owner or
// admin may remove a regular member; only the owner may remove an admin.
// Returns the updated group so the roster refreshes immediately.
export function removeGroupMember(groupId: string, userId: string): Promise<Group> {
  return apiClient.delete<Group>(
    `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
  );
}
