// VibeNet — per-room "last read" watermark, backing the sidebar's unread badges.
//
// Client-side only, mirroring how messageStore.ts already caches decrypted
// history locally: a WhatsApp/Telegram-style unread count needs a per-device
// notion of "read up to when", which the backend has no concept of — its own
// read receipts (see the `read` WS frame in DashboardShell) only tell the
// SENDER their message was seen, not this device what it has and hasn't
// looked at yet, and group rooms have no read receipts at all.
//
// Not namespaced per account like conversations.ts: chat room ids are already
// globally unique (a DM's is the two user ids sorted; a group's is
// "group:<group_id>" — see chatRoomIdFor/groupRoomId), so there's no collision
// risk sharing a device across accounts.

const STORAGE_PREFIX = 'vibenet:lastRead:';

function storageKey(chatRoomId: string): string {
  return `${STORAGE_PREFIX}${chatRoomId}`;
}

// getLastRead returns the unix-ms timestamp up to which this room has been
// read on this device — 0 (the epoch) if never opened, so every cached
// message in a conversation counts as unread until it's first opened here.
export function getLastRead(chatRoomId: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(storageKey(chatRoomId));
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

// markRoomRead advances the watermark to `timestamp`, monotonically — a stale
// call (e.g. from a superseded effect run racing a newer one) can never
// rewind it and resurrect messages that were already marked read.
export function markRoomRead(chatRoomId: string, timestamp: number): void {
  if (typeof window === 'undefined') return;
  if (timestamp <= getLastRead(chatRoomId)) return;
  window.localStorage.setItem(storageKey(chatRoomId), String(timestamp));
}

// unreadCount counts messages sent by someone other than the signed-in user,
// strictly after the room's last-read watermark. System activity notices
// ("X joined the group") never count as unread chat content.
export function unreadCount(
  chatRoomId: string,
  messages: readonly { senderId: string; timestamp: number; isSystem?: boolean }[],
  myUserId: string,
): number {
  const lastRead = getLastRead(chatRoomId);
  let count = 0;
  for (const m of messages) {
    if (!m.isSystem && m.senderId !== myUserId && m.timestamp > lastRead) count++;
  }
  return count;
}
