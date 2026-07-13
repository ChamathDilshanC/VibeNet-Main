// VibeNet — Dashboard app shell: fixed sidebar + main content area.
//
// Owns all the "New chat" state: the client-side conversation registry, the
// live WebSocket connection, and the per-peer AES-GCM key derivation that
// encrypts outgoing messages and decrypts incoming ones. Sidebar and
// NewChatDialog are presentation/selection only — this is where a selected
// peer actually becomes a working encrypted conversation.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Heading } from '@astryxdesign/core/Heading';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { gooeyToast } from 'goey-toast';
import { ApiError, type AuthUser } from '@/lib/api';
import { apiClient } from '@/lib/apiClient';
import { verifyPeerPin } from '@/lib/user';
import {
  applyPeerUpdate,
  chatRoomIdFor,
  listConversations,
  peerName,
  upsertConversation,
  type Conversation,
  type PeerStatus,
} from '@/lib/conversations';
import {
  decryptText,
  deriveSharedKey,
  encryptText,
  generateGroupKeyB64,
  getPrivateKeyJwk,
  importGroupKeyB64,
  importPublicKey,
  publicKeyB64FromPrivateJwk,
} from '@/lib/e2ee';
import {
  acceptInvite as acceptInviteApi,
  addGroupMember,
  createGroup as createGroupApi,
  declineInvite as declineInviteApi,
  fetchGroups,
  fetchInvites,
  groupRoomId,
  leaveGroup as leaveGroupApi,
  memberName,
  removeGroupMember as removeGroupMemberApi,
  renameGroup,
  updateMemberRole as updateMemberRoleApi,
  uploadGroupAvatar,
  type Group,
  type GroupInvite,
  type WrappedKeyInput,
} from '@/lib/groups';
import {
  clearMessages,
  decodeMessageBody,
  deleteMessage,
  encodeMessageBody,
  getMessages,
  markOwnMessagesRead,
  mergeMessages,
  setMessageKept,
  setMessagePinned,
  setMessageStatus,
  type ChatMessage,
  type MessageFileMeta,
  type ReplyPreview,
} from '@/lib/messageStore';
import { encryptFile } from '@/lib/fileCrypto';
import { requestPresignedUpload, uploadEncryptedBlob } from '@/lib/upload';
import { markRoomRead, unreadCount } from '@/lib/readState';
import { useChatSocket } from '@/hooks/useChatSocket';
import { useE2EEKeys } from '@/hooks/useE2EEKeys';
import { ChatView } from './ChatView';
import { ContactsView } from './ContactsView';
import { CreateGroupDialog, type SelectedGroupMember } from './CreateGroupDialog';
import { EmptyState } from './EmptyState';
import { ForwardDialog } from './ForwardDialog';
import { GroupDetailsDialog } from './GroupDetailsDialog';
import { InviteMemberDialog, type InviteTarget } from './InviteMemberDialog';
import { InvitesView } from './InvitesView';
import { NewChatDialog, type ResolvedPeer } from './NewChatDialog';
import { PinPromptDialog } from './PinPromptDialog';
import { SettingsPanel, type SettingsSection } from './SettingsPanel';
import { Sidebar } from './Sidebar';

// What's showing in the main content pane beside the sidebar. 'chat' covers both an
// open conversation and the welcome/empty state — settings, contacts, and invites are
// rendered in place of it, Discord-style, so switching to them never tears down the
// chat shell (socket, conversation registry, derived keys all stay live behind them).
export type DashboardView = 'chat' | 'contacts' | 'settings' | 'invites';

// A frame off the WebSocket. `type` discriminates a chat message from the
// delivery/read control frames (see the backend websocket package); the
// message fields are present only on chat frames, `delivered` only on acks,
// and `chat_room_id` identifies the room for acks and read receipts alike.
interface InboundFrame {
  type?:
    | 'message'
    | 'ack'
    | 'read'
    | 'presence'
    | 'presence_update'
    | 'typing'
    | 'pin_message'
    | 'unpin_message'
    | 'delete_message'
    | 'user_update'
    | 'invite_received'
    | 'group_update'
    | 'removed_from_group';
  message_id?: string;
  sender_id?: string;
  chat_room_id?: string;
  // Set on group-room message/typing frames — identifies which group to route to.
  group_id?: string;
  // invite_received frame: someone invited us to a group.
  invite_id?: string;
  group_name?: string;
  from_name?: string;
  // group_update frame: `name` is set when we were just added to a new group.
  name?: string;
  ciphertext?: string;
  nonce?: string;
  timestamp?: number;
  delivered?: boolean;
  reader_id?: string;
  online?: string[];
  is_forwarded?: boolean;
  // typing frame: a peer started/stopped composing (sender_id carries who).
  is_typing?: boolean;
  // presence_update frame: a peer connected/disconnected (user_id carries who,
  // last_seen set on the offline transition).
  is_online?: boolean;
  last_seen?: number;
  // user_update frame: a peer edited their profile (see UpdateProfile on the
  // backend). Carries public profile fields only, never ciphertext.
  user_id?: string;
  display_name?: string;
  avatar_url?: string;
}

// How often to re-query which peers are online (ms). Presence has no push
// channel, so we poll over the same socket while connected.
const PRESENCE_POLL_MS = 20_000;

// Clear a peer's typing indicator if no further typing frame arrives within this
// window. The sender re-emits "typing" every ~2s while composing (see ChatView
// TYPING_HEARTBEAT_MS), so this must be comfortably larger than that heartbeat to
// avoid clearing mid-typing; it also self-heals a missed "stopped" frame.
const TYPING_TIMEOUT_MS = 5_000;

// Stable empty set for the "nobody known online" case (disconnected), so we
// don't mint a new Set identity on every render.
const NO_ONLINE_PEERS: ReadonlySet<string> = new Set();

interface RemoteMessageDTO {
  message_id: string;
  sender_id: string;
  ciphertext: string;
  nonce: string;
  timestamp: number;
}

export function DashboardShell({
  user,
  onLogout,
  onUserUpdated,
}: {
  user: AuthUser | null;
  onLogout: () => void;
  // Applies a profile the settings panel just persisted, so the sidebar avatar and
  // every other reader of the session agree without a reload (see useAuth.updateUser).
  onUserUpdated: (user: AuthUser) => void;
}) {
  const keyState = useE2EEKeys(user);

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    user ? listConversations(user.user_id) : [],
  );
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  // What the main pane is showing. Opening any conversation returns it to 'chat'
  // (see openPeer), so picking a contact or a DM leaves settings.
  const [activeView, setActiveView] = useState<DashboardView>('chat');
  // Which settings section is open. Held here (rather than inside SettingsPanel) so the
  // sidebar's "Chat PIN" shortcut can jump straight to Privacy & Security.
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile');
  // Chat-PIN gate for NEW conversations only: when the TARGET being messaged has
  // chat_pin_enabled, starting a chat via username search prompts for THAT
  // recipient's PIN (their anti-spam gate) before the room opens — verified
  // server-side against the target's profile. Existing DM sidebar / recent-chat
  // clicks bypass the gate (contact already established). pinPendingConversation
  // holds the not-yet-persisted conversation to open once its PIN is verified;
  // it is intentionally NOT saved until then, so cancelling can't leave a
  // PIN-free openable entry in the sidebar.
  const [pinPendingConversation, setPinPendingConversation] = useState<Conversation | null>(null);
  // Targets whose PIN has already been verified this session, so re-initiating a
  // chat with the same person doesn't prompt again.
  const verifiedPeerIds = useRef<Set<string>>(new Set());
  const [pinVerifying, setPinVerifying] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinErrorNonce, setPinErrorNonce] = useState(0);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  // Bumped each time the dialog opens so NewChatDialog remounts with fresh
  // internal state instead of needing a reset-on-close effect.
  const [newChatSession, setNewChatSession] = useState(0);
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // The message currently being forwarded, if any — drives the ForwardDialog.
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  // Peer IDs currently reported online by the hub (see the presence poll below).
  const [onlinePeers, setOnlinePeers] = useState<Set<string>>(new Set());
  // Peer IDs currently composing a message to us (drives the typing indicator).
  const [typingPeers, setTypingPeers] = useState<Set<string>>(new Set());
  // Per-peer last-seen (unix ms), seeded from the key endpoint on open and kept
  // current by presence_update frames when a peer goes offline.
  const [lastSeenByPeer, setLastSeenByPeer] = useState<Record<string, number>>({});
  // Per-peer auto-clear timers for the typing indicator (see TYPING_TIMEOUT_MS).
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Group chat state ────────────────────────────────────────────────────
  const [groups, setGroups] = useState<Group[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  // The invite currently being accepted/declined — serialises invite actions.
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  // The open group room; mutually exclusive with activePeerId (see openGroup/openPeer).
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  // Bumped each open so CreateGroupDialog remounts with fresh state (same
  // pattern as NewChatDialog's session key).
  const [createGroupSession, setCreateGroupSession] = useState(0);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isInviteMemberOpen, setIsInviteMemberOpen] = useState(false);
  const [isInvitingMember, setIsInvitingMember] = useState(false);
  // Group-details popup (opened by clicking the group chat header).
  const [isGroupDetailsOpen, setIsGroupDetailsOpen] = useState(false);
  const [isSavingGroupName, setIsSavingGroupName] = useState(false);
  const [isUploadingGroupPhoto, setIsUploadingGroupPhoto] = useState(false);
  // The member row currently being promoted/demoted — serialises role changes
  // and disables the acting row's button while its request is in flight.
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null);
  // The member row currently being removed — same serialisation as above.
  const [removingMemberUserId, setRemovingMemberUserId] = useState<string | null>(null);
  // Member IDs currently composing, per group — drives "X is typing…" in the
  // group header. The DM equivalent is the flat typingPeers set above.
  const [groupTyping, setGroupTyping] = useState<Record<string, ReadonlySet<string>>>({});
  // Auto-clear timers for group typing, keyed "<groupId>:<userId>".
  const groupTypingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Unwrapped group keys, cached per group. rawB64 is kept (in memory only)
  // because inviting someone requires re-wrapping the raw key for them — the
  // imported CryptoKey alone is deliberately non-extractable.
  const groupKeyCache = useRef<Map<string, { key: CryptoKey; rawB64: string }>>(new Map());

  // Derived AES-GCM keys are per-peer and deterministic (ECDH) — cache them
  // instead of re-deriving on every message.
  const sharedKeyCache = useRef<Map<string, CryptoKey>>(new Map());

  // ── Group data + key plumbing ───────────────────────────────────────────

  const refreshGroups = useCallback(async () => {
    if (!user) return;
    try {
      setGroups(await fetchGroups());
    } catch {
      // Best-effort — the sidebar keeps whatever it last had; retried on the
      // next reconnect or group_update frame.
    }
  }, [user]);

  const refreshInvites = useCallback(async () => {
    if (!user) return;
    try {
      setInvites(await fetchInvites());
    } catch {
      // Best-effort, same as groups.
    } finally {
      setInvitesLoading(false);
    }
  }, [user]);

  // Our own current public key, re-derived from the locally-held private key
  // (not user.public_key, which can lag behind a self-healed keypair).
  const getOwnPublicKeyB64 = useCallback(async (): Promise<string> => {
    if (!user) throw new Error('Not signed in.');
    const jwk = getPrivateKeyJwk(user.user_id, user.username);
    if (!jwk) throw new Error('Encryption keys are not ready yet.');
    return publicKeyB64FromPrivateJwk(jwk);
  }, [user]);

  // The pairwise AES key between this device and a peer's public key — used
  // to wrap/unwrap group keys, exactly like DM message encryption.
  const derivePairwiseKey = useCallback(
    async (peerPublicKeyB64: string): Promise<CryptoKey> => {
      if (keyState.status !== 'ready') throw new Error('Encryption keys are not ready yet.');
      const theirPublicKey = await importPublicKey(peerPublicKeyB64);
      return deriveSharedKey(keyState.privateKey, theirPublicKey);
    },
    [keyState],
  );

  // Unwraps (and caches) a group's key from our own wrapped copy: derive the
  // pairwise key with whoever wrapped it for us — ourselves for groups we
  // created, the inviter for groups we joined — then decrypt the raw key.
  const getGroupKey = useCallback(
    async (group: Group): Promise<{ key: CryptoKey; rawB64: string } | null> => {
      if (keyState.status !== 'ready' || !user) return null;
      const cached = groupKeyCache.current.get(group.group_id);
      if (cached) return cached;
      try {
        const wrapperPublicKeyB64 =
          group.wrapped_by === user.user_id
            ? await getOwnPublicKeyB64()
            : (
                await apiClient.get<{ public_key: string }>(
                  `/api/users/${group.wrapped_by}/key`,
                )
              ).public_key;
        const pairwise = await derivePairwiseKey(wrapperPublicKeyB64);
        const rawB64 = await decryptText(pairwise, group.wrapped_key, group.key_nonce);
        const entry = { key: await importGroupKeyB64(rawB64), rawB64 };
        groupKeyCache.current.set(group.group_id, entry);
        return entry;
      } catch {
        // Wrong pairwise key (the wrapper rotated their keypair since wrapping,
        // or we lost ours) — group messages stay unreadable on this device.
        return null;
      }
    },
    [keyState, user, getOwnPublicKeyB64, derivePairwiseKey],
  );

  const getSharedKey = useCallback(
    async (peer: Conversation): Promise<CryptoKey | null> => {
      if (keyState.status !== 'ready') return null;
      const cached = sharedKeyCache.current.get(peer.peerId);
      if (cached) return cached;
      const theirPublicKey = await importPublicKey(peer.peerPublicKey);
      const shared = await deriveSharedKey(keyState.privateKey, theirPublicKey);
      sharedKeyCache.current.set(peer.peerId, shared);
      return shared;
    },
    [keyState],
  );

  // Proactively re-fetches a peer's current public key and updates the cached
  // conversation (busting the derived shared key) when it changed. Runs when a
  // conversation is opened so our *outgoing* messages are always encrypted to
  // the peer's current key rather than a copy cached who-knows-when — the
  // sender is the only party that can prevent encrypting to a rotated key.
  // Quiet: an unchanged key is the normal case, not an error.
  const syncPeerPublicKey = useCallback(
    async (conversation: Conversation, currentUserId: string): Promise<Conversation> => {
      try {
        const resolved = await apiClient.get<{
          user_id: string;
          public_key: string;
          display_name?: string;
          avatar_url?: string;
          last_seen?: number;
          status?: PeerStatus;
        }>(`/api/users/${conversation.peerId}/key`);
        // Seed the peer's last-seen so the header can show it immediately when
        // they're offline (presence_update only fires on a live transition).
        if (typeof resolved.last_seen === 'number') {
          const seen = resolved.last_seen;
          setLastSeenByPeer((prev) => ({ ...prev, [conversation.peerId]: seen }));
        }
        const keyChanged = resolved.public_key !== conversation.peerPublicKey;
        // Also backfill the avatar and real name: conversations started before
        // these existed (or from an incoming message) have none cached, so pick
        // them up here even when the key itself hasn't rotated.
        const avatarChanged = (resolved.avatar_url ?? undefined) !== conversation.peerAvatarUrl;
        const resolvedName = resolved.display_name?.trim() || undefined;
        const nameChanged =
          resolvedName !== undefined && resolvedName !== conversation.peerDisplayName;
        const statusChanged =
          resolved.status !== undefined && resolved.status !== conversation.peerStatus;
        if (!keyChanged && !avatarChanged && !nameChanged && !statusChanged) return conversation;
        if (keyChanged) sharedKeyCache.current.delete(conversation.peerId);
        const refreshed: Conversation = {
          ...conversation,
          peerPublicKey: resolved.public_key || conversation.peerPublicKey,
          peerAvatarUrl: resolved.avatar_url,
          peerDisplayName: resolvedName ?? conversation.peerDisplayName,
          peerStatus: resolved.status ?? conversation.peerStatus,
        };
        setConversations(upsertConversation(currentUserId, refreshed));
        return refreshed;
      } catch {
        // Best-effort — a cached key still works if it hasn't rotated.
        return conversation;
      }
    },
    [],
  );

  // Proactively backfill peer avatars so the DM list shows profile photos
  // without the user having to open each chat first. syncPeerPublicKey caches
  // the avatar_url the key endpoint returns into the conversation. Each peer is
  // attempted at most once per mount — password accounts have no avatar and
  // would otherwise be refetched on every conversation-list change.
  const avatarBackfillAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user) return;
    const pending = conversations.filter(
      (c) => c.peerAvatarUrl === undefined && !avatarBackfillAttempted.current.has(c.peerId),
    );
    if (pending.length === 0) return;
    const currentUserId = user.user_id;
    pending.forEach((c) => avatarBackfillAttempted.current.add(c.peerId));
    void (async () => {
      for (const c of pending) {
        await syncPeerPublicKey(c, currentUserId);
      }
    })();
  }, [user, conversations, syncPeerPublicKey]);

  // Re-fetches a peer's current public key, refreshes the cached conversation
  // entry (and busts the cached derived shared key) when it turns out to
  // differ from what we had cached — e.g. they lost their local private key
  // and useE2EEKeys self-healed by generating and uploading a new keypair
  // since we last fetched theirs. Returns null if the server's key matches
  // what we already tried (a real mismatch, not staleness) or the refresh
  // itself fails, so callers can tell "not recoverable" apart from "fixed."
  const refreshPeerSharedKey = useCallback(
    async (
      conversation: Conversation,
      currentUserId: string,
    ): Promise<{ key: CryptoKey; conversation: Conversation } | null> => {
      try {
        const resolved = await apiClient.get<{ user_id: string; public_key: string }>(
          `/api/users/${conversation.peerId}/key`,
        );
        if (resolved.public_key === conversation.peerPublicKey) {
          // Not a recoverable staleness case: the server already advertises the
          // key we tried, so this ciphertext was encrypted under a key that is gone.
          return null;
        }

        sharedKeyCache.current.delete(conversation.peerId);
        const refreshed: Conversation = { ...conversation, peerPublicKey: resolved.public_key };
        setConversations(upsertConversation(currentUserId, refreshed));

        const key = await getSharedKey(refreshed);
        if (!key) return null;
        return { key, conversation: refreshed };
      } catch {
        return null;
      }
    },
    [getSharedKey],
  );

  // Decrypts a single inbound frame, retrying once against a freshly-fetched
  // peer public key on failure (see refreshPeerSharedKey) before giving up.
  // This is what turns a permanent, silent OperationError into a
  // self-correcting resync.
  const decryptIncoming = useCallback(
    async (
      conversation: Conversation,
      ciphertext: string,
      nonce: string,
      currentUserId: string,
    ): Promise<string> => {
      const sharedKey = await getSharedKey(conversation);
      if (!sharedKey) throw new Error('no shared key available');

      try {
        return await decryptText(sharedKey, ciphertext, nonce);
      } catch (err) {
        // The cached public key may be stale (peer rotated it) — refetch their
        // current key and retry once before giving up.
        const refresh = await refreshPeerSharedKey(conversation, currentUserId);
        if (!refresh) throw err;
        return await decryptText(refresh.key, ciphertext, nonce);
      }
    },
    [getSharedKey, refreshPeerSharedKey],
  );

  // Inbound frames that arrive before this device's E2EE keys are ready (e.g.
  // a brand-new browser profile still generating its keypair — see
  // useE2EEKeys) used to be dropped silently by handleIncoming, since
  // getSharedKey has nothing to derive with yet. Queue them here and replay
  // once keyState flips to 'ready' instead of losing them.
  const pendingFramesRef = useRef<InboundFrame[]>([]);

  // Catches a conversation up on anything sent while this device wasn't
  // connected — the WS hub only delivers live, with no queue (see
  // GetChatHistory on the backend). Best-effort: a failed fetch just means
  // live delivery keeps working without the catch-up.
  const syncHistory = useCallback(
    async (conversation: Conversation, currentUserId: string) => {
      try {
        const sharedKey = await getSharedKey(conversation);
        if (!sharedKey) return;

        const { messages: remote } = await apiClient.get<{ messages: RemoteMessageDTO[] }>(
          `/api/messages/${encodeURIComponent(conversation.chatRoomId)}`,
        );
        if (remote.length === 0) return;

        // Skip anything we've already decrypted and cached locally — otherwise
        // every reload re-attempts (and re-fails on) the same old messages that
        // were encrypted under keys this device no longer has, spamming the
        // console and doing pointless crypto work each time.
        const alreadyHave = new Set(getMessages(conversation.chatRoomId).map((m) => m.id));
        const pending = remote.filter((m) => !alreadyHave.has(m.message_id));
        if (pending.length === 0) return;

        const decryptAll = async (key: CryptoKey) => {
          const ok: ChatMessage[] = [];
          for (const m of pending) {
            try {
              const plaintext = await decryptText(key, m.ciphertext, m.nonce);
              const { text, replyTo, isForwarded, isSystem, file } = decodeMessageBody(plaintext);
              ok.push({
                id: m.message_id,
                senderId: m.sender_id,
                text,
                timestamp: m.timestamp,
                replyTo,
                isForwarded,
                isSystem,
                file,
              });
            } catch {
              // Expected for history predating a key rotation/loss — summarised
              // once below rather than logged per message.
            }
          }
          return ok;
        };

        let decrypted = await decryptAll(sharedKey);

        // A miss can mean the peer rotated their key since we cached it — retry
        // once against their current key before concluding it's unrecoverable.
        if (decrypted.length < pending.length) {
          const refresh = await refreshPeerSharedKey(conversation, currentUserId);
          if (refresh) {
            const retried = await decryptAll(refresh.key);
            if (retried.length > decrypted.length) decrypted = retried;
          }
        }

        if (decrypted.length === 0) return;

        const merged = mergeMessages(conversation.chatRoomId, decrypted);
        setMessagesByRoom((prev) => ({ ...prev, [conversation.chatRoomId]: merged }));
      } catch {
        // Network/auth failure — live delivery still works without history.
        // Any messages that stay undecryptable were encrypted under a key
        // that's no longer available, which is expected after key loss.
      }
    },
    [getSharedKey, refreshPeerSharedKey],
  );

  // Goes through mergeMessages (dedupe by id) rather than a blind append —
  // the same message can otherwise land twice: once live over the
  // WebSocket, once again from a history sync a moment later.
  function recordMessage(chatRoomId: string, message: ChatMessage) {
    const merged = mergeMessages(chatRoomId, [message]);
    setMessagesByRoom((prev) => ({ ...prev, [chatRoomId]: merged }));
  }

  const handleIncoming = useCallback(
    (data: unknown) => {
      if (!user) return;
      const frame = data as InboundFrame;

      // Presence snapshot: which of the peers we asked about are online.
      if (frame.type === 'presence') {
        setOnlinePeers(new Set(frame.online ?? []));
        return;
      }

      // Typing indicator: a peer started (is_typing) or stopped composing. Each
      // "true" (re)arms a 3s auto-clear so a missed "false" still resolves.
      if (frame.type === 'typing') {
        const sender = frame.sender_id;
        if (!sender) return;

        // Group room: track per-group WHO is composing (several members can
        // type at once), with the same heartbeat/auto-clear contract as DMs.
        if (frame.group_id) {
          const groupId = frame.group_id;
          const timerKey = `${groupId}:${sender}`;
          const timers = groupTypingTimersRef.current;
          const existing = timers.get(timerKey);
          if (existing) clearTimeout(existing);

          const clearGroupTyping = () =>
            setGroupTyping((prev) => {
              const current = prev[groupId];
              if (!current || !current.has(sender)) return prev;
              const next = new Set(current);
              next.delete(sender);
              return { ...prev, [groupId]: next };
            });

          if (frame.is_typing) {
            setGroupTyping((prev) => {
              const current = prev[groupId];
              if (current?.has(sender)) return prev;
              const next = new Set(current ?? []);
              next.add(sender);
              return { ...prev, [groupId]: next };
            });
            timers.set(
              timerKey,
              setTimeout(() => {
                timers.delete(timerKey);
                clearGroupTyping();
              }, TYPING_TIMEOUT_MS),
            );
          } else {
            timers.delete(timerKey);
            clearGroupTyping();
          }
          return;
        }

        const timers = typingTimersRef.current;
        const existing = timers.get(sender);
        if (existing) clearTimeout(existing);

        const clearTyping = () =>
          setTypingPeers((prev) => {
            if (!prev.has(sender)) return prev;
            const next = new Set(prev);
            next.delete(sender);
            return next;
          });

        if (frame.is_typing) {
          setTypingPeers((prev) => (prev.has(sender) ? prev : new Set(prev).add(sender)));
          timers.set(
            sender,
            setTimeout(() => {
              timers.delete(sender);
              clearTyping();
            }, TYPING_TIMEOUT_MS),
          );
        } else {
          timers.delete(sender);
          clearTyping();
        }
        return;
      }

      // Presence transition: a peer connected/disconnected. Only track peers we
      // actually have a conversation with (mirrors user_update).
      if (frame.type === 'presence_update') {
        const uid = frame.user_id;
        if (!uid || !conversations.some((c) => c.peerId === uid)) return;
        setOnlinePeers((prev) => {
          const has = prev.has(uid);
          if (frame.is_online && !has) return new Set(prev).add(uid);
          if (!frame.is_online && has) {
            const next = new Set(prev);
            next.delete(uid);
            return next;
          }
          return prev;
        });
        if (!frame.is_online) {
          // Offline: record last-seen and drop any lingering typing state.
          if (typeof frame.last_seen === 'number') {
            const seen = frame.last_seen;
            setLastSeenByPeer((prev) => ({ ...prev, [uid]: seen }));
          }
          const timer = typingTimersRef.current.get(uid);
          if (timer) {
            clearTimeout(timer);
            typingTimersRef.current.delete(uid);
          }
          setTypingPeers((prev) => {
            if (!prev.has(uid)) return prev;
            const next = new Set(prev);
            next.delete(uid);
            return next;
          });
        }
        return;
      }

      // Delivery ack for a message we sent: grey single → grey double tick.
      if (frame.type === 'ack') {
        if (frame.delivered && frame.chat_room_id && frame.message_id) {
          const updated = setMessageStatus(frame.chat_room_id, frame.message_id, 'delivered');
          setMessagesByRoom((prev) => ({ ...prev, [frame.chat_room_id!]: updated }));
        }
        return;
      }

      // Read receipt: the recipient opened the chat — flip our sent messages
      // in that room to the blue double tick.
      if (frame.type === 'read') {
        if (frame.chat_room_id) {
          const updated = markOwnMessagesRead(frame.chat_room_id, user.user_id);
          setMessagesByRoom((prev) => ({ ...prev, [frame.chat_room_id!]: updated }));
        }
        return;
      }

      // "Delete for everyone" broadcast: drop the message from our cache too.
      if (frame.type === 'delete_message') {
        if (frame.chat_room_id && frame.message_id) {
          const updated = deleteMessage(frame.chat_room_id, frame.message_id);
          setMessagesByRoom((prev) => ({ ...prev, [frame.chat_room_id!]: updated }));
        }
        return;
      }

      // Pin/unpin broadcast: someone toggled a message's pinned state for the
      // whole room (DM peer, or every group member) — mirror it here too.
      if (frame.type === 'pin_message' || frame.type === 'unpin_message') {
        if (frame.chat_room_id && frame.message_id) {
          const updated = setMessagePinned(
            frame.chat_room_id,
            frame.message_id,
            frame.type === 'pin_message',
          );
          setMessagesByRoom((prev) => ({ ...prev, [frame.chat_room_id!]: updated }));
        }
        return;
      }

      // Someone invited us to a group: refresh the invites list (badge + view)
      // and toast so it's noticeable without watching the sidebar.
      if (frame.type === 'invite_received') {
        void refreshInvites();
        gooeyToast(
          frame.group_name
            ? `${frame.from_name || 'Someone'} invited you to "${frame.group_name}"`
            : 'New group invitation',
          { description: 'Open Invites in the sidebar to accept.' },
        );
        return;
      }

      // Group membership changed: we were added to a group (name present), or a
      // group we're in gained a member. Refetch rather than patch — the list is
      // small and the payload deliberately minimal.
      if (frame.type === 'group_update') {
        void refreshGroups();
        if (frame.name) {
          gooeyToast(`You were added to "${frame.name}"`);
        }
        return;
      }

      // An owner/admin removed us from a group: drop it locally and, if it
      // was open, close the room. Sent as its own frame rather than riding on
      // group_update — by the time that fans out to the remaining roster
      // we're not in it anymore and would never otherwise learn we're gone.
      if (frame.type === 'removed_from_group') {
        const groupId = frame.group_id;
        if (!groupId) return;
        setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
        groupKeyCache.current.delete(groupId);
        if (activeGroupId === groupId) {
          setActiveGroupId(null);
          setIsGroupDetailsOpen(false);
        }
        gooeyToast(
          frame.group_name
            ? `You were removed from "${frame.group_name}"`
            : 'You were removed from a group',
        );
        return;
      }

      // Profile update broadcast: a peer changed their real name / avatar. Patch
      // the cached conversation so the DM list, chat header, and bubbles update
      // live — no reload needed. Only touches peers we actually have a chat with.
      if (frame.type === 'user_update') {
        if (frame.user_id && conversations.some((c) => c.peerId === frame.user_id)) {
          const updated = applyPeerUpdate(user.user_id, frame.user_id, {
            peerDisplayName: frame.display_name,
            peerAvatarUrl: frame.avatar_url,
          });
          setConversations(updated);
        }
        return;
      }

      const {
        sender_id: senderId,
        chat_room_id: chatRoomId,
        ciphertext,
        nonce,
        message_id: messageId,
        timestamp,
        is_forwarded: frameForwarded,
      } = frame;
      if (!senderId || !chatRoomId || !ciphertext || !nonce || !messageId) return;

      // Keys not generated/imported yet (fresh browser profile racing the
      // first inbound message) — queue and replay once ready instead of
      // dropping the frame for good.
      if (keyState.status !== 'ready') {
        pendingFramesRef.current.push(frame);
        return;
      }

      // Group-room message: decrypt under the group key instead of a pairwise
      // key. An unknown group id means we were added after the last fetch —
      // refetch and let the room's history sync recover the message on open.
      if (frame.group_id) {
        const groupId = frame.group_id;
        void (async () => {
          const group = groups.find((g) => g.group_id === groupId);
          if (!group) {
            void refreshGroups();
            return;
          }
          const entry = await getGroupKey(group);
          if (!entry) return;
          try {
            const plaintext = await decryptText(entry.key, ciphertext, nonce);
            const { text, replyTo, isForwarded, isSystem, file } = decodeMessageBody(plaintext);
            recordMessage(chatRoomId, {
              id: messageId,
              senderId,
              text,
              timestamp: timestamp ?? Date.now(),
              isForwarded: isForwarded ?? frameForwarded,
              isSystem,
              replyTo,
              file,
            });
            // A message from them supersedes their typing state — clear it now
            // rather than waiting out the timeout.
            setGroupTyping((prev) => {
              const current = prev[groupId];
              if (!current || !current.has(senderId)) return prev;
              const next = new Set(current);
              next.delete(senderId);
              return { ...prev, [groupId]: next };
            });
          } catch {
            // Undecryptable — wrong group key generation; drop rather than
            // show ciphertext.
          }
        })();
        return;
      }

      void (async () => {
        let conversation = conversations.find((c) => c.peerId === senderId);

        if (!conversation) {
          // First message from someone we haven't started a chat with — resolve
          // just enough to display it. Best-effort: fails silently for
          // PIN-gated senders, since we have no PIN-entry surface here.
          try {
            const resolved = await apiClient.get<{
              user_id: string;
              public_key: string;
              display_name?: string;
              avatar_url?: string;
            }>(`/api/users/${senderId}/key`);
            conversation = {
              peerId: senderId,
              peerUsername: `user_${senderId.slice(0, 8)}`,
              // The key endpoint carries the peer's real name — use it so an
              // unknown first-time sender shows a proper name, not just a stub id.
              peerDisplayName: resolved.display_name?.trim() || undefined,
              peerPublicKey: resolved.public_key,
              peerAvatarUrl: resolved.avatar_url,
              chatRoomId,
              createdAt: Date.now(),
            };
            setConversations(upsertConversation(user.user_id, conversation));
          } catch {
            gooeyToast('New encrypted message from an unknown contact.', {
              description: 'Start a chat with them from "New chat" to read it.',
            });
            return;
          }
        }

        try {
          const plaintext = await decryptIncoming(conversation, ciphertext, nonce, user.user_id);
          // Unwrap the envelope: pulls out the text and any metadata the sender
          // embedded — reply context and the forwarded flag (legacy plain-text
          // bodies decode to just the text).
          const { text, replyTo, isForwarded, file } = decodeMessageBody(plaintext);
          recordMessage(chatRoomId, {
            id: messageId,
            senderId,
            text,
            timestamp: timestamp ?? Date.now(),
            // Render the "Forwarded" tag on the recipient's bubble too. The flag
            // travels inside the ciphertext (the backend drops frame-level extras
            // as a blind router); the frame flag is only a fallback if a future
            // backend starts relaying it.
            isForwarded: isForwarded ?? frameForwarded,
            replyTo,
            file,
          });
        } catch {
          // Undecryptable even after a key-refresh retry — genuinely
          // tampered payload or an unresolvable key mismatch. Drop rather
          // than show ciphertext.
        }
      })();
    },
    [
      conversations,
      decryptIncoming,
      keyState.status,
      user,
      groups,
      getGroupKey,
      refreshGroups,
      refreshInvites,
      activeGroupId,
    ],
  );

  // Replay anything that arrived while keys were still being set up.
  useEffect(() => {
    if (keyState.status !== 'ready' || pendingFramesRef.current.length === 0) return;
    const queued = pendingFramesRef.current;
    pendingFramesRef.current = [];
    for (const frame of queued) handleIncoming(frame);
  }, [keyState.status, handleIncoming]);

  const { status: connectionStatus, send } = useChatSocket(handleIncoming);

  // Load groups + invites on sign-in and again on every reconnect — a
  // group_update/invite_received frame pushed while this device was offline
  // is gone for good, so the reconnect refetch is what heals the gap.
  useEffect(() => {
    if (!user || connectionStatus !== 'open') return;
    void (async () => {
      await refreshGroups();
      await refreshInvites();
    })();
  }, [user, connectionStatus, refreshGroups, refreshInvites]);

  // openPeer opens an existing conversation immediately — sidebar DM rows and
  // the empty-state "Recent chats" list use this path and never trigger the PIN gate.
  const openPeer = useCallback((peerId: string) => {
    if (!peerId) return;
    setActiveView('chat');
    setActivePeerId(peerId);
    setActiveGroupId(null);
  }, []);

  // openGroup opens a group room; a DM and a group are never active together.
  const openGroup = useCallback((groupId: string) => {
    if (!groupId) return;
    setActiveView('chat');
    setActiveGroupId(groupId);
    setActivePeerId(null);
  }, []);

  // Opens settings in the main pane, optionally on a specific section — the sidebar's
  // "Chat PIN" item uses this to land directly on Privacy & Security.
  const openSettings = useCallback((section: SettingsSection = 'profile') => {
    setSettingsSection(section);
    setActiveView('settings');
  }, []);

  // Persists a conversation into the client registry and opens it. Used once a
  // new chat is cleared to open — either immediately (no target PIN) or after the
  // target's PIN is verified.
  const persistAndOpen = useCallback((ownerId: string, conversation: Conversation) => {
    setConversations(upsertConversation(ownerId, conversation));
    setMessagesByRoom((prev) =>
      prev[conversation.chatRoomId]
        ? prev
        : { ...prev, [conversation.chatRoomId]: getMessages(conversation.chatRoomId) },
    );
    setActiveView('chat');
    setActivePeerId(conversation.peerId);
    setActiveGroupId(null);
  }, []);

  async function submitChatPin(code: string) {
    const target = pinPendingConversation;
    if (!user || !target) return;
    setPinVerifying(true);
    try {
      // Verify against the TARGET recipient's PIN profile, not the caller's own.
      await verifyPeerPin(target.peerId, code);
      verifiedPeerIds.current.add(target.peerId);
      setPinPendingConversation(null);
      setPinError(null);
      // Only now is the conversation saved + opened — never before verification.
      persistAndOpen(user.user_id, target);
    } catch (err) {
      // Wrong PIN (403) or any other failure: keep the dialog open and shake.
      setPinError(
        err instanceof ApiError && err.status === 403
          ? 'Incorrect PIN. Try again.'
          : err instanceof Error
            ? err.message
            : 'Could not verify the PIN.',
      );
      setPinErrorNonce((n) => n + 1);
    } finally {
      setPinVerifying(false);
    }
  }

  function handleStartConversation(peer: ResolvedPeer) {
    if (!user) return;
    const conversation: Conversation = {
      peerId: peer.userId,
      peerUsername: peer.username,
      peerDisplayName: peer.displayName,
      peerPublicKey: peer.publicKey,
      peerAvatarUrl: peer.avatarUrl,
      chatRoomId: chatRoomIdFor(user.user_id, peer.userId),
      createdAt: Date.now(),
    };
    // Gate on the TARGET's PIN requirement, not the current user's. Already-verified
    // targets (this session) skip straight through.
    const needsPin =
      peer.chatPinEnabled === true && !verifiedPeerIds.current.has(peer.userId);
    // Search dialog closes on select; defer one frame so the overlay stack never
    // shows two dialogs at once, then either prompt for the target's PIN or open.
    setIsNewChatOpen(false);
    setActiveView('chat');
    requestAnimationFrame(() => {
      if (needsPin) {
        // Hold the conversation unsaved until the PIN is verified (see submitChatPin).
        setPinError(null);
        setPinPendingConversation(conversation);
        return;
      }
      persistAndOpen(user.user_id, conversation);
    });
  }

  // ── Group actions ───────────────────────────────────────────────────────

  // Wraps the raw group key for one recipient: pairwise ECDH key, then the
  // same AES-GCM encrypt used for message bodies. What leaves this function
  // is safe to hand to the server.
  const wrapGroupKeyFor = useCallback(
    async (rawB64: string, recipientPublicKeyB64: string): Promise<WrappedKeyInput> => {
      const pairwise = await derivePairwiseKey(recipientPublicKeyB64);
      const { ciphertext, nonce } = await encryptText(pairwise, rawB64);
      return { wrapped_key: ciphertext, key_nonce: nonce };
    },
    [derivePairwiseKey],
  );

  // Creates the group: mint a group key, wrap it for ourselves and every
  // directly-added member, then hand the wrapped copies to the API. The raw
  // key never leaves this device unencrypted.
  async function handleCreateGroup(name: string, members: SelectedGroupMember[]) {
    if (!user) return;
    setIsCreatingGroup(true);
    try {
      const rawB64 = await generateGroupKeyB64();
      const selfKey = await wrapGroupKeyFor(rawB64, await getOwnPublicKeyB64());
      const memberInputs: Array<{ user_id: string } & WrappedKeyInput> = [];
      for (const member of members) {
        const resolved = await apiClient.get<{ public_key: string }>(
          `/api/users/${member.userId}/key`,
        );
        memberInputs.push({
          user_id: member.userId,
          ...(await wrapGroupKeyFor(rawB64, resolved.public_key)),
        });
      }

      const group = await createGroupApi({ name, selfKey, members: memberInputs });
      // We already hold the raw key — cache it so the first send needs no unwrap.
      groupKeyCache.current.set(group.group_id, {
        key: await importGroupKeyB64(rawB64),
        rawB64,
      });
      setGroups((prev) => [group, ...prev.filter((g) => g.group_id !== group.group_id)]);
      setIsCreateGroupOpen(false);
      openGroup(group.group_id);
      gooeyToast(`Group "${group.name}" created`);

      // Activity log: creation, then each directly-added member — these
      // members never go through the invite/accept flow (that's where
      // "X joined the group" comes from), so without this they'd have no
      // record of how they ended up in the group at all.
      const creatorName = user.display_name || user.username;
      await sendGroupSystemMessage(group, `${creatorName} created the group`);
      for (const member of members) {
        await sendGroupSystemMessage(
          group,
          `${creatorName} added ${member.displayName ?? member.username} to the group`,
        );
      }
    } catch (err) {
      gooeyToast('Could not create group', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsCreatingGroup(false);
    }
  }

  // Invites a user into the open group: unwrap our copy of the group key,
  // re-wrap it for the invitee, and send the invitation.
  async function handleInviteMember(target: InviteTarget) {
    const group = groups.find((g) => g.group_id === activeGroupId);
    if (!user || !group) return;
    setIsInvitingMember(true);
    try {
      const entry = await getGroupKey(group);
      if (!entry) throw new Error('The group key is not available on this device.');
      const resolved = await apiClient.get<{ public_key: string }>(
        `/api/users/${target.userId}/key`,
      );
      const key = await wrapGroupKeyFor(entry.rawB64, resolved.public_key);
      await addGroupMember({ groupId: group.group_id, username: target.username, key });
      setIsInviteMemberOpen(false);
      gooeyToast(`Invite sent to ${target.displayName ?? target.username}`);
    } catch (err) {
      gooeyToast('Could not send invite', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsInvitingMember(false);
    }
  }

  // Renames the open group. The response carries the updated group; other
  // members refresh via the group_update broadcast.
  async function handleRenameGroup(name: string) {
    const group = groups.find((g) => g.group_id === activeGroupId);
    if (!group) return;
    setIsSavingGroupName(true);
    try {
      const updated = await renameGroup(group.group_id, name);
      setGroups((prev) => prev.map((g) => (g.group_id === updated.group_id ? updated : g)));
      gooeyToast('Group renamed');
    } catch (err) {
      gooeyToast('Could not rename group', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSavingGroupName(false);
    }
  }

  // Uploads a new group photo and swaps the updated group into state so the
  // sidebar, header, and details popup all show it immediately.
  async function handleUploadGroupPhoto(file: File) {
    const group = groups.find((g) => g.group_id === activeGroupId);
    if (!group) return;
    setIsUploadingGroupPhoto(true);
    try {
      const updated = await uploadGroupAvatar(group.group_id, file);
      setGroups((prev) => prev.map((g) => (g.group_id === updated.group_id ? updated : g)));
      gooeyToast('Group photo updated');
    } catch (err) {
      gooeyToast('Could not update group photo', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsUploadingGroupPhoto(false);
    }
  }

  // Promotes a member to admin, or demotes an admin back to member. The
  // action button that triggers this is already gated to owner/admin viewers
  // (see GroupDetailsDialog), and the backend enforces the same rule
  // independently — this is UX polish, not the actual security boundary.
  async function handleUpdateMemberRole(userId: string, role: 'admin' | 'member') {
    const group = groups.find((g) => g.group_id === activeGroupId);
    if (!group || !user) return;
    setUpdatingRoleUserId(userId);
    try {
      const updated = await updateMemberRoleApi(group.group_id, userId, role);
      setGroups((prev) => prev.map((g) => (g.group_id === updated.group_id ? updated : g)));
      gooeyToast(role === 'admin' ? 'Member promoted to admin' : 'Admin role removed');

      // Activity log entry so every member can see who changed what, and when.
      const actorName = user.display_name || user.username;
      const target = updated.members.find((m) => m.user_id === userId);
      const targetName = target ? target.display_name.trim() || target.username : 'a member';
      void sendGroupSystemMessage(
        updated,
        role === 'admin'
          ? `${actorName} made ${targetName} an admin`
          : `${actorName} removed ${targetName} as admin`,
      );
    } catch (err) {
      gooeyToast('Could not update role', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setUpdatingRoleUserId(null);
    }
  }

  // Removes another member from the group. The button that triggers this is
  // already gated (owner/admin only, and admin-vs-admin is owner-only — see
  // GroupDetailsDialog); the backend enforces the same rule independently.
  // The removed user learns about it via their own "removed_from_group" frame
  // (handled in handleIncoming), not this call — this only updates our side.
  async function handleRemoveMember(userId: string) {
    const group = groups.find((g) => g.group_id === activeGroupId);
    if (!group || !user) return;
    // Captured before the call: the target won't be in the roster the API
    // hands back once removal succeeds.
    const target = group.members.find((m) => m.user_id === userId);
    const targetName = target ? target.display_name.trim() || target.username : 'a member';

    setRemovingMemberUserId(userId);
    try {
      const updated = await removeGroupMemberApi(group.group_id, userId);
      setGroups((prev) => prev.map((g) => (g.group_id === updated.group_id ? updated : g)));
      gooeyToast(`Removed ${targetName} from the group`);

      const actorName = user.display_name || user.username;
      void sendGroupSystemMessage(updated, `${actorName} removed ${targetName} from the group`);
    } catch (err) {
      gooeyToast('Could not remove member', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRemovingMemberUserId(null);
    }
  }

  // Wipes this device's local cache for the open room — group header menu's
  // "Clear chat". Local only: it never touches server-side history, so a
  // reconnect/history sync can still repopulate anything the backend still
  // has (mirrors "Delete for me" on a single message).
  function handleClearChat() {
    if (!activeRoomId) return;
    const room = activeRoomId;
    const updated = clearMessages(room);
    setMessagesByRoom((prev) => ({ ...prev, [room]: updated }));
    gooeyToast('Chat cleared');
  }

  // Removes the signed-in user from the open group — header menu's "Exit
  // group". The local message cache is left alone (unlike Clear chat): if
  // they're re-invited later there's no reason to have already thrown away
  // history they'd otherwise still be able to read.
  async function handleExitGroup() {
    const group = groups.find((g) => g.group_id === activeGroupId);
    if (!group || !user) return;
    try {
      // Send the activity notice FIRST, while still a member — the backend
      // rejects group frames from non-members, so this has to precede the
      // actual leave call rather than follow it.
      const leaverName = user.display_name || user.username;
      await sendGroupSystemMessage(group, `${leaverName} left the group`);

      await leaveGroupApi(group.group_id);
      setGroups((prev) => prev.filter((g) => g.group_id !== group.group_id));
      groupKeyCache.current.delete(group.group_id);
      setActiveGroupId(null);
      setIsGroupDetailsOpen(false);
      gooeyToast(`Left "${group.name}"`);
    } catch (err) {
      gooeyToast('Could not leave group', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  // Accepting drops the user straight into the group — it appears in the
  // sidebar and opens immediately, no extra step.
  async function handleAcceptInvite(invite: GroupInvite) {
    setBusyInviteId(invite.invite_id);
    try {
      const group = await acceptInviteApi(invite.invite_id);
      setInvites((prev) => prev.filter((i) => i.invite_id !== invite.invite_id));
      setGroups((prev) => [group, ...prev.filter((g) => g.group_id !== group.group_id)]);
      openGroup(group.group_id);
      gooeyToast(`Joined "${group.name}"`);
      if (user) void sendGroupSystemMessage(group, `${user.display_name || user.username} joined the group`);
    } catch (err) {
      gooeyToast('Could not accept invite', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyInviteId(null);
    }
  }

  async function handleDeclineInvite(invite: GroupInvite) {
    setBusyInviteId(invite.invite_id);
    try {
      await declineInviteApi(invite.invite_id);
      setInvites((prev) => prev.filter((i) => i.invite_id !== invite.invite_id));
    } catch (err) {
      gooeyToast('Could not decline invite', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyInviteId(null);
    }
  }

  // Catches a group room up on messages sent while this device wasn't
  // connected — the group analogue of syncHistory, decrypting under the group
  // key instead of a pairwise key.
  const syncGroupHistory = useCallback(
    async (group: Group) => {
      try {
        const entry = await getGroupKey(group);
        if (!entry) return;
        const roomId = groupRoomId(group.group_id);

        const { messages: remote } = await apiClient.get<{ messages: RemoteMessageDTO[] }>(
          `/api/messages/${encodeURIComponent(roomId)}`,
        );
        if (remote.length === 0) return;

        const alreadyHave = new Set(getMessages(roomId).map((m) => m.id));
        const pending = remote.filter((m) => !alreadyHave.has(m.message_id));
        if (pending.length === 0) return;

        const decrypted: ChatMessage[] = [];
        for (const m of pending) {
          try {
            const plaintext = await decryptText(entry.key, m.ciphertext, m.nonce);
            const { text, replyTo, isForwarded, isSystem, file } = decodeMessageBody(plaintext);
            decrypted.push({
              id: m.message_id,
              senderId: m.sender_id,
              text,
              timestamp: m.timestamp,
              replyTo,
              isForwarded,
              isSystem,
              file,
            });
          } catch {
            // Encrypted under a key generation this device can't recover — skip.
          }
        }
        if (decrypted.length === 0) return;

        const merged = mergeMessages(roomId, decrypted);
        setMessagesByRoom((prev) => ({ ...prev, [roomId]: merged }));
      } catch {
        // Network/auth failure — live delivery still works without history.
      }
    },
    [getGroupKey],
  );

  // Group counterpart of the DM history-resync effect below: runs when a group
  // is opened, when the socket reconnects while one is open, and again once
  // E2EE keys finish setting up (the first open can race key generation).
  useEffect(() => {
    if (connectionStatus !== 'open' || !activeGroupId) return;
    const group = groups.find((g) => g.group_id === activeGroupId);
    if (!group) return;
    void (async () => {
      await syncGroupHistory(group);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync on open/reconnect/keys-ready only; `groups`/`syncGroupHistory` identity churn would only repeat work.
  }, [connectionStatus, activeGroupId, keyState.status]);

  // Fetches history whenever the active conversation changes (new chat
  // started, or an existing one selected from the sidebar) and again if the
  // connection drops and reconnects while a conversation is open — otherwise
  // anything sent during the gap would only show up on the next full reload.
  useEffect(() => {
    if (connectionStatus !== 'open' || !activePeerId || !user) return;
    const conversation = conversations.find((c) => c.peerId === activePeerId);
    if (!conversation) return;
    const currentUserId = user.user_id;
    // Refresh the peer's public key first so our outgoing messages target
    // their current key, then catch up on history.
    void (async () => {
      const fresh = await syncPeerPublicKey(conversation, currentUserId);
      await syncHistory(fresh, currentUserId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync on reconnect only; re-running for every unrelated `conversations`/`syncHistory` identity change would be wasteful, not incorrect.
  }, [connectionStatus, activePeerId]);

  // Encrypts under the group key and sends a group-room frame — the backend
  // fans it out to every member and persists it once under "group:<id>".
  async function handleSendGroup(group: Group, text: string, replyTo?: ReplyPreview) {
    if (!user) return;
    setIsSending(true);
    setSendError(null);
    try {
      // The composer already blocks sending until this device's own E2EE keys
      // are ready (see ChatView's keysReady), so reaching this with no entry
      // means the group key itself couldn't be unwrapped — a different,
      // rarer problem than "not ready yet".
      const entry = await getGroupKey(group);
      if (!entry) throw new Error('Could not access the group encryption key. Try reopening the group.');

      const { ciphertext, nonce } = await encryptText(
        entry.key,
        encodeMessageBody(text, { replyTo }),
      );
      const messageId = crypto.randomUUID();
      const timestamp = Date.now();
      const roomId = groupRoomId(group.group_id);

      const enqueued = send({
        type: 'message',
        message_id: messageId,
        group_id: group.group_id,
        chat_room_id: roomId,
        ciphertext,
        nonce,
        timestamp,
      });
      if (!enqueued) throw new Error('Not connected — reconnecting, try again shortly.');

      // Single tick optimistically; the hub's ack (queued to ≥1 member)
      // upgrades it to a double tick. Group rooms have no read receipts.
      recordMessage(roomId, {
        id: messageId,
        senderId: user.user_id,
        text,
        timestamp,
        status: 'sent',
        replyTo,
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setIsSending(false);
    }
  }

  // Sends a group activity notice ("X made Y an admin", "X joined the group")
  // through the exact same encrypted pipeline as a normal message, so it's
  // persisted to history and reaches every member — ChatView renders it as a
  // centered system pill instead of a bubble (see ChatMessage.isSystem).
  // Fire-and-forget: the membership/role change already succeeded by the time
  // this is called, so a failure here shouldn't roll anything back — it just
  // means the log entry doesn't show up.
  const sendGroupSystemMessage = useCallback(
    async (group: Group, text: string) => {
      if (!user) return;
      try {
        const entry = await getGroupKey(group);
        if (!entry) return;

        const { ciphertext, nonce } = await encryptText(
          entry.key,
          encodeMessageBody(text, { isSystem: true }),
        );
        const messageId = crypto.randomUUID();
        const timestamp = Date.now();
        const roomId = groupRoomId(group.group_id);

        send({
          type: 'message',
          message_id: messageId,
          group_id: group.group_id,
          chat_room_id: roomId,
          ciphertext,
          nonce,
          timestamp,
        });
        recordMessage(roomId, {
          id: messageId,
          senderId: user.user_id,
          text,
          timestamp,
          status: 'sent',
          isSystem: true,
        });
      } catch {
        // Best-effort notice — nothing to roll back on failure.
      }
    },
    [user, getGroupKey, send],
  );

  async function handleSend(text: string, replyTo?: ReplyPreview) {
    if (!user) return;
    if (activeGroupId) {
      const group = groups.find((g) => g.group_id === activeGroupId);
      if (group) await handleSendGroup(group, text, replyTo);
      return;
    }
    const conversation = conversations.find((c) => c.peerId === activePeerId);
    if (!conversation) return;

    setIsSending(true);
    setSendError(null);
    try {
      const sharedKey = await getSharedKey(conversation);
      if (!sharedKey) throw new Error('Encryption keys are not ready yet.');

      // Wrap the text (and reply metadata, when replying) in the envelope
      // before encrypting, so the whole reply context is end-to-end encrypted.
      const { ciphertext, nonce } = await encryptText(
        sharedKey,
        encodeMessageBody(text, { replyTo }),
      );
      const messageId = crypto.randomUUID();
      const timestamp = Date.now();

      const enqueued = send({
        type: 'message',
        message_id: messageId,
        receiver_id: conversation.peerId,
        chat_room_id: conversation.chatRoomId,
        ciphertext,
        nonce,
        timestamp,
      });
      if (!enqueued) throw new Error('Not connected — reconnecting, try again shortly.');

      // Optimistically show a single tick; the server's delivery ack upgrades
      // it to a double tick, and the recipient's read receipt turns it blue.
      recordMessage(conversation.chatRoomId, {
        id: messageId,
        senderId: user.user_id,
        text,
        timestamp,
        status: 'sent',
        replyTo,
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setIsSending(false);
    }
  }

  // fileMessageCaption is the plaintext fallback shown for a file/image
  // message — it rides in the envelope's ordinary `text` field alongside the
  // structured `file` metadata, so search, notifications, and any client that
  // doesn't understand `file` yet all still show something readable.
  function fileMessageCaption(name: string, mimeType: string): string {
    return mimeType.startsWith('image/') ? `📷 ${name}` : `📎 ${name}`;
  }

  // Encrypts a file/image entirely client-side (see lib/fileCrypto), uploads
  // the ciphertext to S3 via a presigned URL (see lib/upload) — the backend
  // and any database/S3 admin only ever see that ciphertext — then wraps the
  // resulting AES key/IV/S3 object key inside the same encrypted envelope
  // already used for text (encodeMessageBody's `file` field) and sends it
  // through the identical WebSocket 'message' pipeline as handleSend/
  // handleSendGroup. No backend changes were needed for the messaging side of
  // this: the server has always treated ciphertext as an opaque blob.
  async function handleSendFile(file: File) {
    if (!user) return;
    const group = activeGroupId ? groups.find((g) => g.group_id === activeGroupId) : undefined;
    const conversation = activeGroupId
      ? undefined
      : conversations.find((c) => c.peerId === activePeerId);
    if (!group && !conversation) return;

    setIsSending(true);
    setSendError(null);
    try {
      // Resolve the room's encryption key first — the same key text messages
      // use — so a doomed send fails before spending a network round-trip on
      // the (potentially large) encrypt-and-upload step below.
      let sharedKey: CryptoKey | null = null;
      if (group) {
        const entry = await getGroupKey(group);
        if (!entry) {
          throw new Error('Could not access the group encryption key. Try reopening the group.');
        }
        sharedKey = entry.key;
      } else {
        sharedKey = await getSharedKey(conversation!);
        if (!sharedKey) throw new Error('Encryption keys are not ready yet.');
      }

      const { blob, keyB64, ivB64 } = await encryptFile(file);
      const { uploadUrl, fileKey } = await requestPresignedUpload(file.name, file.type);
      await uploadEncryptedBlob(uploadUrl, blob);

      const fileMeta: MessageFileMeta = {
        key: fileKey,
        keyB64,
        ivB64,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      };
      const caption = fileMessageCaption(file.name, fileMeta.mimeType);

      const { ciphertext, nonce } = await encryptText(
        sharedKey,
        encodeMessageBody(caption, { file: fileMeta }),
      );
      const messageId = crypto.randomUUID();
      const timestamp = Date.now();
      const roomId = group ? groupRoomId(group.group_id) : conversation!.chatRoomId;

      const enqueued = send({
        type: 'message',
        message_id: messageId,
        ...(group ? { group_id: group.group_id } : { receiver_id: conversation!.peerId }),
        chat_room_id: roomId,
        ciphertext,
        nonce,
        timestamp,
      });
      if (!enqueued) throw new Error('Not connected — reconnecting, try again shortly.');

      recordMessage(roomId, {
        id: messageId,
        senderId: user.user_id,
        text: caption,
        timestamp,
        status: 'sent',
        file: fileMeta,
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not send file.');
    } finally {
      setIsSending(false);
    }
  }

  // ── Per-message actions (surfaced by ChatView's context menu) ──────────────
  // These operate on the open room — DM or group alike (activeRoomId resolves
  // to whichever is active): ChatView only renders the active room, so every
  // message it hands back belongs to it.

  function handleTogglePin(message: ChatMessage) {
    if (!activeRoomId) return;
    const room = activeRoomId;
    const nextPinned = !message.pinned;
    const updated = setMessagePinned(room, message.id, nextPinned);
    setMessagesByRoom((prev) => ({ ...prev, [room]: updated }));

    // Broadcast the toggle to everyone else in the room — the DM peer, or
    // every group member — so the pinned banner stays in sync for them too;
    // our own local mirror above is already set.
    const routing = activeGroup
      ? { group_id: activeGroup.group_id }
      : activeConversation
        ? { receiver_id: activeConversation.peerId }
        : null;
    if (routing) {
      send({
        type: nextPinned ? 'pin_message' : 'unpin_message',
        message_id: message.id,
        chat_room_id: room,
        ...routing,
      });
    }
    gooeyToast(nextPinned ? 'Message pinned' : 'Message unpinned');
  }

  function handleToggleKeep(message: ChatMessage) {
    if (!activeRoomId) return;
    const room = activeRoomId;
    const nextKept = !message.kept;
    const updated = setMessageKept(room, message.id, nextKept);
    setMessagesByRoom((prev) => ({ ...prev, [room]: updated }));
    gooeyToast(nextKept ? 'Added to Kept' : 'Removed from Kept');
  }

  function handleDeleteForMe(message: ChatMessage) {
    if (!activeRoomId) return;
    const room = activeRoomId;
    const updated = deleteMessage(room, message.id);
    setMessagesByRoom((prev) => ({ ...prev, [room]: updated }));
  }

  function handleDeleteForEveryone(message: ChatMessage) {
    if (!activeRoomId) return;
    const room = activeRoomId;
    const updated = deleteMessage(room, message.id);
    setMessagesByRoom((prev) => ({ ...prev, [room]: updated }));
    // Ask the hub to broadcast the deletion (and drop it from DynamoDB).
    send({ type: 'delete_message', message_id: message.id, chat_room_id: room });
    gooeyToast('Message deleted for everyone');
  }

  // Forward re-encrypts the already-decrypted plaintext under the chosen
  // contact's shared key and sends fresh ciphertext — the hallmark of E2EE
  // forwarding: the server never sees plaintext and can't reuse the original
  // ciphertext, which was encrypted for a different recipient.
  async function handleForward(peerId: string, message: ChatMessage | null) {
    if (!user || !message) return;
    const target = conversations.find((c) => c.peerId === peerId);
    if (!target) return;
    try {
      const sharedKey = await getSharedKey(target);
      if (!sharedKey) throw new Error('Encryption keys are not ready yet.');

      // Forwarded flag rides inside the encrypted envelope (not just the WS
      // frame) so it survives the backend's blind relay and reaches the peer.
      // A forwarded file/image doesn't need re-uploading — the same S3 object
      // key and AES key/IV just get re-wrapped under the new recipient's
      // shared key, exactly like the text does.
      const { ciphertext, nonce } = await encryptText(
        sharedKey,
        encodeMessageBody(message.text, { isForwarded: true, file: message.file }),
      );
      const messageId = crypto.randomUUID();
      const timestamp = Date.now();

      const enqueued = send({
        type: 'message',
        message_id: messageId,
        receiver_id: target.peerId,
        chat_room_id: target.chatRoomId,
        ciphertext,
        nonce,
        timestamp,
        // Tell the recipient (and the history record) this is a forward, so
        // their bubble renders the "Forwarded" tag too — the flag rides
        // alongside the ciphertext, never the plaintext.
        is_forwarded: true,
      });
      if (!enqueued) throw new Error('Not connected — reconnecting, try again shortly.');

      recordMessage(target.chatRoomId, {
        id: messageId,
        senderId: user.user_id,
        text: message.text,
        timestamp,
        status: 'sent',
        // Mark our own optimistic bubble as forwarded up front — without this
        // the tag never appears on the sender's side until a history refetch.
        isForwarded: true,
        file: message.file,
      });
      gooeyToast(`Forwarded to ${peerName(target)}`);
    } catch (err) {
      gooeyToast('Could not forward message', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const activeGroup = groups.find((g) => g.group_id === activeGroupId) ?? null;
  const activeConversation = activeGroup
    ? null
    : (conversations.find((c) => c.peerId === activePeerId) ?? null);
  // The open room's id, whichever kind is active — what the per-message
  // actions and the message list key off.
  const activeRoomId = activeGroup
    ? groupRoomId(activeGroup.group_id)
    : (activeConversation?.chatRoomId ?? null);
  const activeMessages = activeRoomId
    ? (messagesByRoom[activeRoomId] ?? getMessages(activeRoomId))
    : [];
  // IDs (and roster names derived from them, in the same order) of the members
  // composing in the open group, for the header and the typing bubble — the
  // bubble's avatar is resolved from the first id. Never includes ourselves (the
  // hub excludes senders).
  const activeGroupTypingIds = activeGroup
    ? [...(groupTyping[activeGroup.group_id] ?? [])]
    : [];
  const activeGroupTypingNames = activeGroup
    ? activeGroupTypingIds.map((id) => memberName(activeGroup, id))
    : [];

  // While a conversation is open, tell the peer we've read their messages so
  // their sent bubbles turn blue. Re-runs when a new message arrives (the
  // message count changes) so incoming messages are marked read as they land.
  const activePeer = activeConversation?.peerId;
  const activeRoom = activeConversation?.chatRoomId;
  const hasPeerMessages = activeMessages.some((m) => m.senderId === activePeer);
  useEffect(() => {
    if (connectionStatus !== 'open' || !activePeer || !activeRoom || !hasPeerMessages) return;
    send({ type: 'read', receiver_id: activePeer, chat_room_id: activeRoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `send` is stable enough; re-sending on its identity change would be wasteful, not incorrect.
  }, [connectionStatus, activePeer, activeRoom, hasPeerMessages, activeMessages.length]);

  // Advances the open room's local "last read" watermark (see lib/readState) to
  // its newest message — on first opening it, and again whenever a further
  // message lands while it stays open, so the sidebar's unread badge never
  // grows for the room you're actively looking at. Purely local bookkeeping
  // (no network), unlike the DM `read` frame above which tells the PEER their
  // message was seen; this is what lets THIS device remember what it has and
  // hasn't shown you once you navigate away.
  useEffect(() => {
    if (!activeRoomId || activeMessages.length === 0) return;
    markRoomRead(activeRoomId, activeMessages[activeMessages.length - 1].timestamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on length, not the array/its contents; a same-length replacement (this app never edits messages) wouldn't need re-marking anyway.
  }, [activeRoomId, activeMessages.length]);

  // Unread counts for the sidebar, keyed by peer/group id rather than room id so
  // Sidebar doesn't need to know how either kind derives its room id. Plain
  // consts recomputed each render (not useMemo — the React Compiler already
  // memoizes derived values like this throughout the component, and manual
  // memoization here can't be preserved across activeRoomId's own derivation).
  // The open room always reads 0 — it's on screen, not unread — rather than
  // depending on the watermark effect above having already flushed this render.
  const unreadByPeer: Record<string, number> = {};
  const unreadByGroup: Record<string, number> = {};
  if (user) {
    for (const c of conversations) {
      unreadByPeer[c.peerId] =
        c.chatRoomId === activeRoomId
          ? 0
          : unreadCount(c.chatRoomId, messagesByRoom[c.chatRoomId] ?? getMessages(c.chatRoomId), user.user_id);
    }
    for (const g of groups) {
      const roomId = groupRoomId(g.group_id);
      unreadByGroup[g.group_id] =
        roomId === activeRoomId
          ? 0
          : unreadCount(roomId, messagesByRoom[roomId] ?? getMessages(roomId), user.user_id);
    }
  }

  // Poll the hub for which conversation peers are online while connected. Sorted
  // + joined so the effect only restarts when the set of peers actually changes.
  const peerIdsKey = conversations
    .map((c) => c.peerId)
    .sort()
    .join(',');
  useEffect(() => {
    if (connectionStatus !== 'open' || peerIdsKey === '') return;
    const userIds = peerIdsKey.split(',');
    const query = () => send({ type: 'presence', user_ids: userIds });
    query();
    const timer = setInterval(query, PRESENCE_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `send` is stable enough; re-subscribing on its identity change would needlessly reset the poll.
  }, [connectionStatus, peerIdsKey]);

  // Clear any pending typing auto-clear timers (DM and group) on unmount.
  useEffect(() => {
    const timers = typingTimersRef.current;
    const groupTimers = groupTypingTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      groupTimers.forEach((t) => clearTimeout(t));
      groupTimers.clear();
    };
  }, []);

  // While disconnected we can't trust the last snapshot, so show everyone
  // offline until the socket reopens and the poll refreshes it.
  const visibleOnlinePeers = connectionStatus === 'open' ? onlinePeers : NO_ONLINE_PEERS;

  return (
    <AppShell
      contentPadding={0}
      height="fill"
      sideNav={
        <Sidebar
          user={user}
          conversations={conversations}
          groups={groups}
          activePeerId={activePeerId}
          activeGroupId={activeGroupId}
          pendingInviteCount={invites.length}
          onlinePeers={visibleOnlinePeers}
          unreadByPeer={unreadByPeer}
          unreadByGroup={unreadByGroup}
          onSelectConversation={openPeer}
          onSelectGroup={openGroup}
          onNewChat={() => {
            setNewChatSession((n) => n + 1);
            setIsNewChatOpen(true);
          }}
          onCreateGroup={() => {
            setCreateGroupSession((n) => n + 1);
            setIsCreateGroupOpen(true);
          }}
          onInvites={() => setActiveView('invites')}
          onContacts={() => setActiveView('contacts')}
          onSettings={openSettings}
          activeView={activeView}
          onLogout={onLogout}
        />
      }>
      {activeView === 'settings' ? (
        <SettingsPanel
          user={user}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          onUserUpdated={onUserUpdated}
          onLogout={onLogout}
        />
      ) : activeView === 'contacts' ? (
        <ContactsView
          conversations={conversations}
          onlinePeers={visibleOnlinePeers}
          onSelectContact={openPeer}
          onNewChat={() => {
            setNewChatSession((n) => n + 1);
            setIsNewChatOpen(true);
          }}
        />
      ) : activeView === 'invites' ? (
        <InvitesView
          invites={invites}
          isLoading={invitesLoading}
          busyInviteId={busyInviteId}
          onAccept={(invite) => void handleAcceptInvite(invite)}
          onDecline={(invite) => void handleDeclineInvite(invite)}
        />
      ) : activeGroup ? (
        <ChatView
          group={activeGroup}
          messages={activeMessages}
          myUserId={user?.user_id ?? ''}
          onSend={handleSend}
          onSendFile={handleSendFile}
          isSending={isSending}
          sendError={sendError}
          keysReady={keyState.status === 'ready'}
          connectionStatus={connectionStatus}
          typingNames={activeGroupTypingNames}
          typingUserIds={activeGroupTypingIds}
          onTyping={(isTyping) =>
            send({
              type: 'typing',
              group_id: activeGroup.group_id,
              chat_room_id: groupRoomId(activeGroup.group_id),
              is_typing: isTyping,
            })
          }
          onInviteMember={() => setIsInviteMemberOpen(true)}
          onOpenDetails={() => setIsGroupDetailsOpen(true)}
          onClearChat={handleClearChat}
          onExitGroup={() => void handleExitGroup()}
          onForward={setForwardingMessage}
          onTogglePin={handleTogglePin}
          onToggleKeep={handleToggleKeep}
          onDeleteForMe={handleDeleteForMe}
          onDeleteForEveryone={handleDeleteForEveryone}
        />
      ) : activeConversation ? (
        <ChatView
          conversation={activeConversation}
          messages={activeMessages}
          myUserId={user?.user_id ?? ''}
          onSend={handleSend}
          onSendFile={handleSendFile}
          isSending={isSending}
          sendError={sendError}
          keysReady={keyState.status === 'ready'}
          connectionStatus={connectionStatus}
          isPeerOnline={visibleOnlinePeers.has(activeConversation.peerId)}
          peerLastSeen={lastSeenByPeer[activeConversation.peerId] ?? null}
          peerStatus={activeConversation.peerStatus}
          isPeerTyping={typingPeers.has(activeConversation.peerId)}
          onTyping={(isTyping) =>
            send({
              type: 'typing',
              receiver_id: activeConversation.peerId,
              chat_room_id: activeConversation.chatRoomId,
              is_typing: isTyping,
            })
          }
          onForward={setForwardingMessage}
          onTogglePin={handleTogglePin}
          onToggleKeep={handleToggleKeep}
          onDeleteForMe={handleDeleteForMe}
          onDeleteForEveryone={handleDeleteForEveryone}
        />
      ) : (
        <Layout
          height="fill"
          contentWidth={768}
          content={
            <LayoutContent padding={6}>
              <VStack gap={2}>
                <Heading level={1} type="display-3">
                  Welcome{user ? `, ${user.display_name || user.username}` : ''}
                </Heading>
                <Text type="body" color="secondary">
                  Your end-to-end encrypted workspace is ready. Pick a
                  conversation from the sidebar or start a new chat.
                </Text>
                <EmptyState
                  conversations={conversations}
                  onlinePeers={visibleOnlinePeers}
                  onSelect={openPeer}
                />
              </VStack>
            </LayoutContent>
          }
        />
      )}

      {user && (
        <NewChatDialog
          // Session keys force a remount-with-fresh-state per open. Namespaced
          // (not the bare counter) because these dialogs are siblings: two bare
          // counters both starting at 0 collide as duplicate React keys.
          key={`new-chat-${newChatSession}`}
          isOpen={isNewChatOpen}
          onOpenChange={setIsNewChatOpen}
          currentUserId={user.user_id}
          onStart={handleStartConversation}
        />
      )}

      {user && (
        <CreateGroupDialog
          key={`create-group-${createGroupSession}`}
          isOpen={isCreateGroupOpen}
          onOpenChange={setIsCreateGroupOpen}
          currentUserId={user.user_id}
          isCreating={isCreatingGroup}
          onCreate={(name, members) => void handleCreateGroup(name, members)}
        />
      )}

      {user && (
        <InviteMemberDialog
          // Remount per group so a previous search doesn't leak across rooms.
          key={`invite-member-${activeGroupId ?? 'none'}`}
          isOpen={isInviteMemberOpen}
          onOpenChange={setIsInviteMemberOpen}
          group={activeGroup}
          isInviting={isInvitingMember}
          onInvite={(target) => void handleInviteMember(target)}
        />
      )}

      {user && (
        <GroupDetailsDialog
          // Remount per group so an in-progress name edit never leaks between rooms.
          key={`group-details-${activeGroupId ?? 'none'}`}
          isOpen={isGroupDetailsOpen && activeGroup !== null}
          onOpenChange={setIsGroupDetailsOpen}
          group={activeGroup}
          currentUserId={user.user_id}
          isSavingName={isSavingGroupName}
          isUploadingPhoto={isUploadingGroupPhoto}
          updatingRoleUserId={updatingRoleUserId}
          removingMemberUserId={removingMemberUserId}
          onRename={(name) => void handleRenameGroup(name)}
          onUploadPhoto={(file) => void handleUploadGroupPhoto(file)}
          onInviteMember={() => {
            // Swap popups rather than stacking two dialogs.
            setIsGroupDetailsOpen(false);
            setIsInviteMemberOpen(true);
          }}
          onUpdateRole={(userId, role) => void handleUpdateMemberRole(userId, role)}
          onRemoveMember={(userId) => void handleRemoveMember(userId)}
        />
      )}

      {/* PIN gate for new-chat initiation only — verifies the TARGET recipient's
          PIN. Existing sidebar DMs (established contacts) open directly. */}
      {user && (
        <PinPromptDialog
          isOpen={pinPendingConversation !== null}
          title={
            pinPendingConversation
              ? `Enter ${peerName(pinPendingConversation)}'s chat PIN`
              : 'Enter chat PIN'
          }
          avatarName={pinPendingConversation ? peerName(pinPendingConversation) : ''}
          avatarUrl={pinPendingConversation?.peerAvatarUrl}
          subtitle={
            pinPendingConversation
              ? `${peerName(pinPendingConversation)} protects new chats with a PIN. Enter their 6-digit code to start the conversation.`
              : 'Enter the 6-digit chat PIN to start this conversation.'
          }
          isVerifying={pinVerifying}
          error={pinError}
          errorNonce={pinErrorNonce}
          onSubmit={(code) => void submitChatPin(code)}
          onCancel={() => {
            setPinPendingConversation(null);
            setPinError(null);
          }}
        />
      )}

      {user && (
        <ForwardDialog
          isOpen={forwardingMessage !== null}
          onOpenChange={(open) => {
            if (!open) setForwardingMessage(null);
          }}
          conversations={conversations}
          messagePreview={forwardingMessage?.text ?? ''}
          onForward={(peerId) => handleForward(peerId, forwardingMessage)}
        />
      )}
    </AppShell>
  );
}
