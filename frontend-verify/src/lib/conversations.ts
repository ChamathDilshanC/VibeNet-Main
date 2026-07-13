// Client-side conversation registry.
//
// The backend has no "contacts" or "conversations" endpoint — a DM is just two
// user IDs. Starting a chat (see NewChatDialog) fetches the peer's public key
// once and caches everything needed to resume the conversation — including
// after a reload — as a small localStorage table, namespaced per signed-in
// account since a device may hold sessions for more than one user over time.

const STORAGE_PREFIX = 'vibenet:conversations:';

/** Peer account lifecycle state, mirrored from the backend's userSummary/publicKeyResponse. */
export type PeerStatus = 'active' | 'deactivated' | 'deleted';

export interface Conversation {
  peerId: string;
  peerUsername: string;
  /** Peer's "real name" — what the UI shows in place of the username. Cached from
   *  search / the key endpoint and kept fresh by live user_update events. May be
   *  absent for older cached conversations; peerName() falls back to the username. */
  peerDisplayName?: string;
  /** base64 SPKI — cached from GET /api/users/{id}/key so we don't re-fetch on every reload. */
  peerPublicKey: string;
  /** Peer's Google avatar URL, if any — cached from search / the key endpoint so the
   *  DM list, chat header, and bubbles show their photo instead of only initials.
   *  Absent for password accounts (they fall back to initials). */
  peerAvatarUrl?: string;
  /** Peer's account lifecycle state, refreshed each time the conversation is opened
   *  (see syncPeerPublicKey in DashboardShell). Absent for conversations cached before
   *  this field existed or before the first refresh — treat as 'active'. */
  peerStatus?: PeerStatus;
  /** Deterministic room id both peers derive independently — see chatRoomIdFor. */
  chatRoomId: string;
  createdAt: number;
}

// chatRoomIdFor derives the same room id regardless of which side computes it,
// since there's no backend "create room" call to hand one out.
export function chatRoomIdFor(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(':');
}

// peerName is the single source of truth for what to call a peer in the UI: the
// real name when set, otherwise the username. Everything that renders a peer's
// name (DM list, chat header, bubbles) routes through this so the fallback is
// consistent and a blank display name never shows.
export function peerName(conversation: Conversation): string {
  const display = conversation.peerDisplayName?.trim();
  return display ? display : conversation.peerUsername;
}

function storageKey(ownerId: string): string {
  return `${STORAGE_PREFIX}${ownerId}`;
}

export function listConversations(ownerId: string): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(ownerId));
    const parsed = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return parsed.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

// upsertConversation adds a new conversation or refreshes an existing peer's
// cached public key (keys can rotate), keyed by peerId.
export function upsertConversation(ownerId: string, conversation: Conversation): Conversation[] {
  if (typeof window === 'undefined') return [];
  const existing = listConversations(ownerId).filter((c) => c.peerId !== conversation.peerId);
  const next = [conversation, ...existing];
  window.localStorage.setItem(storageKey(ownerId), JSON.stringify(next));
  return next;
}

// applyPeerUpdate patches a peer's cached display name and/or avatar in place
// (list order preserved, unlike upsertConversation) and persists the result —
// used when a live user_update event reports a peer renamed themselves mid-chat.
// Only defined patch fields overwrite; returns the updated list.
export function applyPeerUpdate(
  ownerId: string,
  peerId: string,
  patch: { peerDisplayName?: string; peerAvatarUrl?: string },
): Conversation[] {
  if (typeof window === 'undefined') return [];
  const next = listConversations(ownerId).map((c) =>
    c.peerId === peerId
      ? {
          ...c,
          peerDisplayName: patch.peerDisplayName ?? c.peerDisplayName,
          peerAvatarUrl: patch.peerAvatarUrl ?? c.peerAvatarUrl,
        }
      : c,
  );
  window.localStorage.setItem(storageKey(ownerId), JSON.stringify(next));
  return next;
}
