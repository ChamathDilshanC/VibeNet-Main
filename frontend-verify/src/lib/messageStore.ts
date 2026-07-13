// Local message cache, keyed by chat room.
//
// The WebSocket hub only delivers to a recipient who's connected at the exact
// moment a message is sent — there's no queue, so anything sent while you
// were offline would otherwise be lost. GET /api/messages/{chatRoomId} lets a
// client catch up on reconnect (see mergeMessages); this cache is what makes
// that — and a plain page reload — survive locally, the same way the E2EE
// private key itself is only ever local. Only decrypted text is cached here,
// never ciphertext.

const STORAGE_PREFIX = 'vibenet:messages:';

// Delivery lifecycle of a message we sent, WhatsApp-style:
//   sent      — left this device / reached the server (single tick)
//   delivered — the recipient is online and received it (grey double tick)
//   read      — the recipient has opened the chat (blue double tick)
// Received messages carry no status (ticks only render on our own bubbles).
export type MessageStatus = 'sent' | 'delivered' | 'read';

const STATUS_RANK: Record<MessageStatus, number> = { sent: 0, delivered: 1, read: 2 };

// A compact snapshot of the message being replied to, embedded in the reply so
// the quoted block renders without having to look the original up (it may have
// scrolled off, been deleted, or never synced to this device). Carried inside
// the E2EE payload, so the server never sees any of it in the clear.
export interface ReplyPreview {
  /** Id of the quoted message — lets the UI scroll/highlight it if still present. */
  messageId: string;
  /** Display name to show above the quote ("You" for our own messages). */
  senderName: string;
  /** One-line, already-truncated preview of the quoted message's text. */
  textPreview: string;
}

// MessageFileMeta describes an E2EE file/image attachment. The AES key and IV
// are the raw material needed to decrypt the ciphertext stored at `key` in
// S3 — safe to carry here in the clear (as far as this interface is
// concerned) only because the whole envelope this lives inside is itself
// encrypted under the conversation/group's shared key before it ever leaves
// the device (see encodeMessageBody/encryptText). `key` is an S3 object key,
// not a URL: fetching it requires exchanging it for a fresh presigned GET via
// lib/upload.ts's requestDownloadUrl every time it's rendered.
export interface MessageFileMeta {
  key: string;
  keyB64: string;
  ivB64: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  status?: MessageStatus;
  /** Set when this message is a reply — drives the in-bubble quoted block. */
  replyTo?: ReplyPreview;
  /** Set when this message carries an encrypted file/image attachment instead
   *  of (or alongside) plain text — see MessageAttachment.tsx. */
  file?: MessageFileMeta;
  /** Pinned for the whole room (see pin_message over the WebSocket). Local mirror
   *  of the shared pin state so the bubble + pinned banner render without a refetch. */
  pinned?: boolean;
  /** "Kept"/starred by this user for quick access — a purely local flag, never
   *  sent over the wire. Persisted here so it survives a reload like the message. */
  kept?: boolean;
  /** True when this message was forwarded from another conversation. Renders a
   *  "Forwarded" label at the top of the bubble, WhatsApp/Messenger-style. */
  isForwarded?: boolean;
  /** True for a group activity notice ("X made Y an admin", "X joined the
   *  group") rather than a message someone typed. Sent through the same
   *  encrypted pipeline as a normal message (so it's persisted and visible to
   *  every member) but rendered as a centered system pill instead of a bubble
   *  — see ChatView. senderId is still whoever's client generated it. */
  isSystem?: boolean;
}

// ── Encrypted message body envelope ────────────────────────────────────────
// The plaintext we encrypt used to be the raw message string. To carry reply
// metadata end-to-end (without ever exposing it to the server) we now wrap the
// body in a small versioned JSON envelope *before* encryption, and unwrap it
// after decryption. `v` tags the format; legacy messages predate the envelope
// and decrypt to a bare string, which decodeMessageBody treats as plain text.
interface MessageEnvelope {
  v: 1;
  text: string;
  replyTo?: ReplyPreview;
  isForwarded?: boolean;
  isSystem?: boolean;
  // File attachments (see MessageFileMeta) ride inside the same encrypted
  // envelope as text: the AES file key/IV need E2EE protection exactly like
  // a message body does, and this envelope's own encryptText call under the
  // conversation/group's shared key is "the existing E2EE logic" that gives
  // them it — no separate encryption pass needed.
  file?: MessageFileMeta;
}

// Metadata that rides inside the encrypted envelope alongside the text. Carried
// here (not in the WebSocket frame) precisely so it reaches the recipient: the
// backend is a blind router with a fixed frame shape and would drop any extra
// top-level fields, but it never touches the ciphertext, so envelope metadata
// survives end-to-end.
export interface MessageMeta {
  replyTo?: ReplyPreview;
  isForwarded?: boolean;
  isSystem?: boolean;
  file?: MessageFileMeta;
}

// encodeMessageBody produces the string handed to encryptText — a JSON envelope
// so the reply context and forwarded flag travel inside the ciphertext with the
// text. Falsy metadata is omitted to keep the payload compact.
export function encodeMessageBody(text: string, meta: MessageMeta = {}): string {
  const envelope: MessageEnvelope = { v: 1, text };
  if (meta.replyTo) envelope.replyTo = meta.replyTo;
  if (meta.isForwarded) envelope.isForwarded = true;
  if (meta.isSystem) envelope.isSystem = true;
  if (meta.file) envelope.file = meta.file;
  return JSON.stringify(envelope);
}

// decodeMessageBody reverses encodeMessageBody on the decrypted string. Anything
// that isn't a v1 envelope (a pre-envelope plain-text message, or a peer on an
// older build) falls back to being treated as the whole body — so old and new
// messages both render correctly.
export function decodeMessageBody(raw: string): {
  text: string;
  replyTo?: ReplyPreview;
  isForwarded?: boolean;
  isSystem?: boolean;
  file?: MessageFileMeta;
} {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageEnvelope>;
    if (parsed && parsed.v === 1 && typeof parsed.text === 'string') {
      return {
        text: parsed.text,
        replyTo: parsed.replyTo,
        isForwarded: parsed.isForwarded,
        isSystem: parsed.isSystem,
        file: parsed.file,
      };
    }
  } catch {
    // Not JSON — a legacy plain-text body from before the envelope existed.
  }
  return { text: raw };
}

function storageKey(chatRoomId: string): string {
  return `${STORAGE_PREFIX}${chatRoomId}`;
}

// Status only ever moves forward (sent → delivered → read); a later frame that
// carries a lower or missing status must never regress a message.
function mergeStatus(a?: MessageStatus, b?: MessageStatus): MessageStatus | undefined {
  if (!a) return b;
  if (!b) return a;
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

export function getMessages(chatRoomId: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(chatRoomId));
    const parsed = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return parsed.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

// mergeMessages folds freshly-decrypted history (e.g. from GET /api/messages)
// into the local cache, de-duplicating by id against what's already there —
// the same message can otherwise arrive twice: once live over the WebSocket,
// once again from history on the next reconnect.
export function mergeMessages(chatRoomId: string, incoming: ChatMessage[]): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  const existing = getMessages(chatRoomId);
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const message of incoming) {
    const prev = byId.get(message.id);
    // Fold in the incoming copy but never lose the local-only flags: history/live
    // frames carry neither `pinned` nor `kept`, so a naive overwrite would clear a
    // message the user had just pinned or kept. Status still only moves forward.
    byId.set(
      message.id,
      prev
        ? {
            ...message,
            status: mergeStatus(prev.status, message.status),
            pinned: message.pinned ?? prev.pinned,
            kept: message.kept ?? prev.kept,
            isForwarded: message.isForwarded ?? prev.isForwarded,
            isSystem: message.isSystem ?? prev.isSystem,
            replyTo: message.replyTo ?? prev.replyTo,
          }
        : message,
    );
  }
  const next = Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
  window.localStorage.setItem(storageKey(chatRoomId), JSON.stringify(next));
  return next;
}

// setMessageStatus advances a single message's delivery state in the cache
// (e.g. on a delivery ack), never regressing it. Returns the updated list.
export function setMessageStatus(
  chatRoomId: string,
  messageId: string,
  status: MessageStatus,
): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  const messages = getMessages(chatRoomId).map((m) =>
    m.id === messageId ? { ...m, status: mergeStatus(m.status, status) } : m,
  );
  window.localStorage.setItem(storageKey(chatRoomId), JSON.stringify(messages));
  return messages;
}

// markOwnMessagesRead flips every message we sent in a room to "read" (blue
// double tick) when the recipient signals they've opened the chat. Only our
// own messages are touched — identified by senderId === myUserId.
export function markOwnMessagesRead(chatRoomId: string, myUserId: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  const messages = getMessages(chatRoomId).map((m) =>
    m.senderId === myUserId ? { ...m, status: mergeStatus(m.status, 'read') } : m,
  );
  window.localStorage.setItem(storageKey(chatRoomId), JSON.stringify(messages));
  return messages;
}

function writeMessages(chatRoomId: string, messages: ChatMessage[]): ChatMessage[] {
  if (typeof window === 'undefined') return messages;
  window.localStorage.setItem(storageKey(chatRoomId), JSON.stringify(messages));
  return messages;
}

// deleteMessage drops a message from the local cache entirely. Used by both
// "delete for me" (local only) and "delete for everyone" (local + a
// delete_message broadcast) — the WebSocket side is the caller's concern; this
// only touches what's stored on this device. Returns the remaining messages.
export function deleteMessage(chatRoomId: string, messageId: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  return writeMessages(
    chatRoomId,
    getMessages(chatRoomId).filter((m) => m.id !== messageId),
  );
}

// clearMessages wipes a room's entire local cache — "Clear chat" from the
// header menu. Local only, like "delete for me": it doesn't touch history on
// the server, so a reconnect/history sync can still repopulate anything the
// backend still has. Returns the (now empty) list for the caller to mirror.
export function clearMessages(chatRoomId: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  return writeMessages(chatRoomId, []);
}

// setMessagePinned toggles a message's room-wide pinned flag in the local cache.
// Pinning is shared (broadcast over the socket); this keeps the local mirror in
// step so the bubble and the pinned banner update immediately.
export function setMessagePinned(
  chatRoomId: string,
  messageId: string,
  pinned: boolean,
): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  return writeMessages(
    chatRoomId,
    getMessages(chatRoomId).map((m) => (m.id === messageId ? { ...m, pinned } : m)),
  );
}

// setMessageKept toggles this user's local "kept"/starred flag for a message.
// Purely local — never leaves the device — but persisted so it survives reloads.
export function setMessageKept(
  chatRoomId: string,
  messageId: string,
  kept: boolean,
): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  return writeMessages(
    chatRoomId,
    getMessages(chatRoomId).map((m) => (m.id === messageId ? { ...m, kept } : m)),
  );
}
