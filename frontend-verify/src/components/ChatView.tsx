// VibeNet — active conversation panel: header, message list, composer.
//
// Renders in place of EmptyState once a conversation is selected. Messages
// are plaintext by the time they reach this component — DashboardShell
// decrypts on receive and encrypts on send, so this is purely a display +
// input concern.
//
// Layout is a full-height flex column (fills the AppShell content region):
// a sticky header, an optional pinned-message banner, a single scrolling
// message region, and a composer pinned at the bottom that never scrolls away.
// Each bubble carries a hover context menu (see MessageContextMenu) with the
// full WhatsApp-style action set; the composer grows a reply preview above it
// when a message is being replied to, and a selection bar replaces the header
// while multi-select is active.

'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Popover } from '@astryxdesign/core/Popover';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  CheckCircleIcon as CheckCircleOutlineIcon,
  FaceSmileIcon,
  PaperClipIcon,
  Square2StackIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  BookmarkIcon as BookmarkSolidIcon,
  CheckCircleIcon as CheckCircleSolidIcon,
  MapPinIcon as MapPinSolidIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/solid';
import { gooeyToast } from 'goey-toast';
import type { ChatSocketStatus } from '@/hooks/useChatSocket';
import { resolveAvatarUrl } from '@/lib/api';
import { peerName, type Conversation, type PeerStatus } from '@/lib/conversations';
import { canManageGroup, memberName, type Group } from '@/lib/groups';
import type { ChatMessage, ReplyPreview } from '@/lib/messageStore';
import { DeliveryTicks } from './DeliveryTicks';
import { EmojiPicker } from './EmojiPicker';
import { GroupContextMenu } from './GroupContextMenu';
import { MessageAttachment } from './MessageAttachment';
import { MessageContextMenu } from './MessageContextMenu';
import { TypingIndicator } from './TypingIndicator';

const CONNECTION_LABEL: Record<ChatSocketStatus, string> = {
  open: 'Connected',
  connecting: 'Connecting…',
  closed: 'Reconnecting…',
};

const CONNECTION_VARIANT: Record<ChatSocketStatus, 'success' | 'warning' | 'neutral'> = {
  open: 'success',
  connecting: 'neutral',
  closed: 'warning',
};

// While a peer keeps typing we re-emit "typing" on this cadence (a heartbeat) so
// the receiver's inactivity timeout keeps refreshing and the indicator never
// disappears mid-typing. Must be shorter than the receiver's clear timeout (see
// DashboardShell TYPING_TIMEOUT_MS).
const TYPING_HEARTBEAT_MS = 2000;
// After this much keystroke silence, tell the peer we've stopped typing.
const TYPING_IDLE_MS = 3000;
// Cap on the composer's auto-grow height (px, roughly 6-7 lines) — beyond
// this a long paste (a code snippet, say) scrolls inside the box instead of
// pushing the whole composer off-screen.
const MAX_COMPOSER_HEIGHT_PX = 160;
// Client-side guard only — the presigned S3 PUT itself has no size limit the
// backend can enforce (it never sees the bytes). Large enough for photos and
// small documents without risking hanging the browser on the encrypt step,
// which reads the whole file into memory at once.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Human "last seen" line for an offline peer, e.g. "Last seen today at 10:30 AM".
// Uses native Intl only — no date library. Null/unknown reads as a plain "Offline".
function formatLastSeen(ts?: number | null): string {
  if (!ts) return 'Offline';
  const then = new Date(ts);
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);
  if (dayDiff <= 0) return `Last seen today at ${time}`;
  if (dayDiff === 1) return `Last seen yesterday at ${time}`;
  if (dayDiff < 7) {
    return `Last seen ${then.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  }
  return `Last seen ${then.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// Fixed palette a sender's name label is picked from — WhatsApp/Telegram
// style, so a group chat with several people doesn't render every name in the
// same green. Ten hues, each dark/saturated enough to stay legible on both a
// white bubble (light mode) and gray-900 (dark mode) without needing a
// separate dark-mode variant per color.
const SENDER_NAME_COLORS = [
  '#d1453b', // red
  '#e0862f', // amber
  '#9c6ade', // purple
  '#2f9e44', // green
  '#12a3a3', // teal
  '#3b82c4', // blue
  '#d6478a', // pink
  '#b8860b', // gold
  '#4f9e8f', // sea green
  '#7c6fd6', // indigo
];

// Deterministic hash → stable palette index, so the same sender always gets
// the same color across messages, reloads, and everyone's screen — not a
// fresh random pick each render, which would make names flicker between
// colors and disagree between participants.
function colorForSender(senderId: string): string {
  let hash = 0;
  for (let i = 0; i < senderId.length; i++) {
    hash = (hash * 31 + senderId.charCodeAt(i)) | 0;
  }
  return SENDER_NAME_COLORS[Math.abs(hash) % SENDER_NAME_COLORS.length];
}

// A day separator label: "Today"/"Yesterday" for the two most recent days,
// otherwise a written-out date (the year is dropped when it's the current one).
function dayLabel(timestamp: number): string {
  const now = Date.now();
  if (isSameDay(timestamp, now)) return 'Today';
  if (isSameDay(timestamp, now - 86_400_000)) return 'Yesterday';
  const date = new Date(timestamp);
  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}


// "Forwarded" label pinned to the top of a bubble, above the username/text.
// Muted, smaller and italic to sit quietly out of the way like other chat
// apps. `tone` matches the bubble it lives on (white text on the blue sender
// bubble, grey on the light receiver bubble).
function ForwardedTag({ tone }: { tone: 'sender' | 'receiver' }) {
  // Muted against whichever bubble it sits on: a translucent white on the blue
  // sender bubble, grey-500 on the light receiver bubble. mb-1.5 gives it clear
  // air above the username/text so it reads as a header, not part of the body.
  const color = tone === 'sender' ? 'text-white/75' : 'text-gray-500 dark:text-gray-400';
  return (
    <span className={`mb-1.5 flex items-center gap-1 text-xs italic ${color}`}>
      <ArrowUturnRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Forwarded
    </span>
  );
}

// WhatsApp-style quoted reply, rendered inside the bubble just above the new
// message text. A left accent bar plus a muted fill set it apart from the body;
// the tone matches the bubble it sits on — a translucent white on the blue
// sender bubble, a black tint on the light receiver bubble — so it never breaks
// the existing colour scheme. The preview text is pre-truncated by the caller.
function ReplyQuote({ replyTo, tone }: { replyTo: ReplyPreview; tone: 'sender' | 'receiver' }) {
  const isSender = tone === 'sender';
  return (
    <div
      className={[
        'mb-1.5 overflow-hidden rounded-lg border-l-4 py-1 pl-2 pr-2.5',
        isSender
          ? 'border-white/70 bg-white/10'
          : 'border-[var(--vibe-blue)] bg-black/5 dark:bg-white/10',
      ].join(' ')}>
      <span
        className={`block text-xs font-semibold ${isSender ? 'text-white' : 'text-[var(--vibe-blue)]'}`}>
        {replyTo.senderName}
      </span>
      <span className={`block truncate text-xs ${isSender ? 'text-white/75' : 'text-gray-500 dark:text-gray-400'}`}>
        {replyTo.textPreview}
      </span>
    </div>
  );
}

// Truncated one-line preview of a message body — used by the reply preview and
// the pinned banner.
function previewText(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

// Callbacks a bubble needs; grouped so both the row and its context menu share
// the same shape.
interface MessageActions {
  onReply: (message: ChatMessage) => void;
  onCopy: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onTogglePin: (message: ChatMessage) => void;
  onToggleKeep: (message: ChatMessage) => void;
  onStartSelect: (message: ChatMessage) => void;
  onReport: (message: ChatMessage) => void;
  onDeleteForMe: (message: ChatMessage) => void;
  onDeleteForEveryone: (message: ChatMessage) => void;
}

function MessageRow({
  message,
  isMine,
  senderName,
  senderAvatarUrl,
  senderColor,
  readReceiptName,
  readReceiptAvatarUrl,
  actions,
  menuOpen,
  onMenuOpenChange,
  selectMode,
  isSelected,
  onToggleSelect,
  showReadReceipt,
}: {
  message: ChatMessage;
  isMine: boolean;
  // Resolved by the parent so the row renders identically for DMs (always the
  // peer) and group rooms (looked up per message from the roster).
  senderName: string;
  senderAvatarUrl?: string;
  // The sender's name-label color — resolved by the parent so it can be
  // assigned uniquely per room (see ChatView's groupSenderColors) rather than
  // picked in isolation here, which is what let two different senders land on
  // the same color by coincidence.
  senderColor: string;
  // Who the "seen" avatar depicts — the DM peer. Unused in group rooms, where
  // showReadReceipt is always false (there are no group read receipts).
  readReceiptName?: string;
  readReceiptAvatarUrl?: string;
  actions: MessageActions;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: (message: ChatMessage) => void;
  // Messenger/Instagram-style "seen" marker: when true this is the newest of
  // our messages the recipient has read, so their avatar sits below the bubble.
  showReadReceipt: boolean;
}) {
  // The hover chevron lives in the bubble's top-right corner — on both our own
  // and the peer's bubbles it stays pinned to the far right so the trigger is
  // always in a predictable spot. Keep it mounted but invisible until the row
  // is hovered (or its menu is open, so it doesn't vanish while you're using
  // it). The bubbles reserve right padding (pr-9) so it never crowds the text.
  // On the blue sender bubble the chevron is tinted white for contrast; on the
  // light receiver bubble it stays grey.
  const trigger = (
    <div
      className={[
        'absolute right-1 top-1 z-10 transition-opacity',
        isMine ? '[&_svg]:text-white/90' : '[&_svg]:text-gray-500',
        menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
      ].join(' ')}
      // The menu is an action surface, not part of the selection hit area.
      onClick={(e) => e.stopPropagation()}>
      <MessageContextMenu
        message={message}
        isMine={isMine}
        isOpen={menuOpen}
        onOpenChange={onMenuOpenChange}
        onReply={() => actions.onReply(message)}
        onCopy={() => actions.onCopy(message)}
        onForward={() => actions.onForward(message)}
        onTogglePin={() => actions.onTogglePin(message)}
        onToggleKeep={() => actions.onToggleKeep(message)}
        onSelect={() => actions.onStartSelect(message)}
        onReport={() => actions.onReport(message)}
        onDeleteForMe={() => actions.onDeleteForMe(message)}
        onDeleteForEveryone={() => actions.onDeleteForEveryone(message)}
      />
    </div>
  );

  const rowSelectProps = selectMode
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => onToggleSelect(message),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSelect(message);
          }
        },
      }
    : {};

  const SelectMark = isSelected ? CheckCircleSolidIcon : CheckCircleOutlineIcon;

  // Swipe-to-reply: the bubble is draggable on the x-axis; releasing past the
  // threshold fires the same reply action as the context menu. dragX also drives
  // a reply-arrow hint that fades in on the left as you pull. Constraints pin it
  // to x:0 both sides, so it always springs back to rest on release.
  const dragX = useMotionValue(0);
  const replyHintOpacity = useTransform(dragX, [0, 60], [0, 1]);

  // Right-clicking a bubble opens the same menu as the hover chevron, instead
  // of the browser's native context menu — same options either way. Disabled
  // in select mode, mirroring the chevron trigger being hidden there too.
  const openMenuOnRightClick = (e: React.MouseEvent) => {
    if (selectMode) return;
    e.preventDefault();
    onMenuOpenChange(true);
  };

  // A plain image message (no reply/forward context to make room for) drops
  // the bubble's own padding/background entirely — the photo fills the whole
  // rounded shape edge-to-edge, WhatsApp/Instagram-style, with its timestamp
  // overlaid on the image itself (see MessageAttachment) instead of sitting in
  // the normal text row below. A reply or forward tag needs the padded bubble
  // to sit inside, so those cases keep the ordinary chrome.
  const isImageMessage = message.file?.mimeType.startsWith('image/') ?? false;
  const isEdgeToEdgeImage = isImageMessage && !message.isForwarded && !message.replyTo;

  return (
    <div
      {...rowSelectProps}
      className={[
        'group -mx-2 flex items-center gap-2 rounded-2xl px-2 py-0.5 transition-colors',
        selectMode ? 'cursor-pointer' : '',
        isSelected ? 'bg-[var(--vibe-blue)]/10' : selectMode ? 'hover:bg-black/[0.03]' : '',
      ].join(' ')}>
      {selectMode && (
        <SelectMark
          className={`h-6 w-6 shrink-0 ${isSelected ? 'text-[var(--vibe-blue)]' : 'text-gray-400 dark:text-gray-500'}`}
          aria-hidden="true"
        />
      )}

      {/* Swipe-to-reply: drag the bubble to the right to reply. The hint arrow
          sits behind the bubble and fades in as you pull; releasing past the
          threshold fires the same onReply as the context menu, then the bubble
          springs back (dragConstraints pin it to x:0). */}
      <div className="relative flex min-w-0 flex-1">
        <motion.div
          aria-hidden="true"
          style={{ opacity: replyHintOpacity }}
          className="pointer-events-none absolute left-1 top-1/2 z-0 -translate-y-1/2 text-[var(--vibe-blue)]">
          <ArrowUturnLeftIcon className="h-5 w-5" />
        </motion.div>

        <motion.div
          drag={selectMode ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          style={{ x: dragX }}
          onDragEnd={(_event, info) => {
            if (info.offset.x > 50) actions.onReply(message);
          }}
          className="flex min-w-0 flex-1">
          {isMine ? (
        // Sender bubble — right aligned, solid blue, white text. Laid out as a
        // row (items-end) so the read-receipt avatar sits just to the right of
        // the bubble, completely outside it, with its center level with the
        // timestamp + double-tick line.
        <div className="vibe-msg-in flex flex-1 origin-bottom-right items-end justify-end gap-1.5">
          <div
            onContextMenu={openMenuOnRightClick}
            className={[
              'relative max-w-[75%] rounded-2xl rounded-br-md text-white shadow-sm',
              isEdgeToEdgeImage
                ? ''
                : 'bg-[var(--vibe-blue)] py-2.5 pl-4 pr-9 [text-shadow:0_1px_1px_rgba(2,20,40,0.28)]',
            ].join(' ')}>
            {!selectMode && trigger}
            {message.isForwarded && <ForwardedTag tone="sender" />}
            {message.replyTo && <ReplyQuote replyTo={message.replyTo} tone="sender" />}
            {message.file && (
              <MessageAttachment
                file={message.file}
                tone="sender"
                timestamp={message.timestamp}
                status={message.status}
                isKept={message.kept}
                isPinned={message.pinned}
              />
            )}
            {!message.file && (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {message.text}
              </p>
            )}
            {!isEdgeToEdgeImage && (
              <span className="mt-1 flex items-center justify-end gap-1 text-[11px] text-white/85">
                {message.kept && (
                  <BookmarkSolidIcon className="h-3 w-3 text-white/85" aria-label="Kept" />
                )}
                {message.pinned && (
                  <MapPinSolidIcon className="h-3 w-3 text-white/85" aria-label="Pinned" />
                )}
                {formatTime(message.timestamp)}
                {message.status && <DeliveryTicks status={message.status} />}
              </span>
            )}
          </div>
          {showReadReceipt && (
            // The recipient's avatar, tucked just to the right of the bubble and
            // level with the timestamp/tick line — an Instagram/Messenger "seen"
            // cue alongside the blue double-tick. The mb-2.5 lifts its center to
            // the timestamp baseline (matching the bubble's py-2.5 padding).
            //
            // Wrapped in a motion.div so that whenever the read marker advances
            // to a newer message this avatar mounts on the new row and slides
            // down into place from the previous message's height — a subtle
            // "descending" seen trail. Keyed by message id so each advance is a
            // fresh mount that replays the entrance.
            <motion.div
              key={message.id}
              initial={{ y: -40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.7 }}
              className="mb-2.5 shrink-0">
              <Avatar
                src={resolveAvatarUrl(readReceiptAvatarUrl)}
                name={readReceiptName}
                size={16}
                alt={`Seen by ${readReceiptName}`}
                // rounded-full is load-bearing: this className lands on the Avatar's
                // ROOT element, whose border-radius is 0 (the circle is clipped on an
                // inner div). Tailwind's ring is a box-shadow that follows the
                // element's own radius, so without it the ring draws as a square —
                // invisible white-on-white in light mode, glaring in dark. The ring is
                // canvas-coloured per theme so it reads as a cut-out gap, not a frame.
                className="rounded-full ring-1 ring-white dark:ring-gray-950"
              />
            </motion.div>
          )}
        </div>
      ) : (
        // Receiver bubble — left aligned, avatar + name, light gray.
        <div className="vibe-msg-in flex flex-1 origin-bottom-left items-end gap-2">
          <Avatar src={resolveAvatarUrl(senderAvatarUrl)} name={senderName} size="small" />
          <div
            onContextMenu={openMenuOnRightClick}
            className={[
              'relative max-w-[75%] rounded-2xl rounded-tl-md shadow-sm',
              isEdgeToEdgeImage
                ? ''
                : 'bg-white py-2.5 pl-4 pr-9 ring-1 ring-black/[0.03] dark:bg-gray-900',
            ].join(' ')}>
            {!selectMode && trigger}
            {message.isForwarded && <ForwardedTag tone="receiver" />}
            <span
              className={[
                'mb-0.5 block text-[13px] font-semibold',
                isEdgeToEdgeImage ? 'px-1 pt-1' : '',
              ].join(' ')}
              style={{ color: senderColor }}>
              {senderName}
            </span>
            {message.replyTo && <ReplyQuote replyTo={message.replyTo} tone="receiver" />}
            {message.file && (
              <MessageAttachment
                file={message.file}
                tone="receiver"
                timestamp={message.timestamp}
                isKept={message.kept}
                isPinned={message.pinned}
              />
            )}
            {!message.file && (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-200">
                {message.text}
              </p>
            )}
            {!isEdgeToEdgeImage && (
              <span className="mt-1 flex items-center justify-end gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                {message.kept && (
                  <BookmarkSolidIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" aria-label="Kept" />
                )}
                {message.pinned && (
                  <MapPinSolidIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" aria-label="Pinned" />
                )}
                {formatTime(message.timestamp)}
              </span>
            )}
          </div>
        </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

export function ChatView({
  conversation = null,
  group = null,
  messages,
  myUserId,
  onSend,
  onSendFile,
  isSending,
  sendError,
  keysReady = true,
  connectionStatus,
  isPeerOnline = false,
  peerLastSeen,
  peerStatus,
  isPeerTyping = false,
  typingNames = [],
  typingUserIds = [],
  onTyping,
  onInviteMember,
  onOpenDetails,
  onClearChat,
  onExitGroup,
  onForward,
  onTogglePin,
  onToggleKeep,
  onDeleteForMe,
  onDeleteForEveryone,
}: {
  /** The open DM. Exactly one of `conversation`/`group` is set. */
  conversation?: Conversation | null;
  /** The open group room — switches the header, sender names, and typing labels
   *  to roster-based resolution while every other behaviour stays shared. */
  group?: Group | null;
  messages: ChatMessage[];
  myUserId: string;
  onSend: (text: string, replyTo?: ReplyPreview) => void;
  /** Encrypts, uploads, and sends a file/image attachment (see DashboardShell's
   *  handleSendFile). Omitted entirely disables the attach-file button. */
  onSendFile?: (file: File) => void;
  isSending: boolean;
  sendError: string | null;
  /** False while this device's E2EE keypair is still being generated/published
   *  (freshest right after a first-ever login) — sending before then always
   *  fails, so the composer blocks it instead of surfacing a confusing error.
   *  Defaults to true so a caller that doesn't pass it fails open, not shut. */
  keysReady?: boolean;
  connectionStatus: ChatSocketStatus;
  /** Whether the DM peer currently has a live WebSocket connection. */
  isPeerOnline?: boolean;
  /** DM peer's last-seen time (unix ms), shown when offline. */
  peerLastSeen?: number | null;
  /** DM peer's account lifecycle state (refreshed when the conversation opens — see
   *  syncPeerPublicKey in DashboardShell). Undefined/'active' renders normally; a
   *  deactivated/deleted peer replaces the online/typing/last-seen status line with
   *  an account-status line, and a deleted peer additionally disables the composer. */
  peerStatus?: PeerStatus;
  /** Whether the DM peer is currently composing — drives the typing indicator. */
  isPeerTyping?: boolean;
  /** Display names of group members currently composing ("X is typing…"). */
  typingNames?: string[];
  /** User IDs backing `typingNames`, same order — used to resolve the typing
   *  bubble's avatar to the actual composing member instead of a blank initial. */
  typingUserIds?: string[];
  /** Notify the room that we started/stopped composing (throttled here). */
  onTyping: (isTyping: boolean) => void;
  /** Opens the invite dialog — the group header menu's "Add member", shown
   *  only when the signed-in member is the owner or an admin. */
  onInviteMember?: () => void;
  /** Opens the group-details popup — both the header menu's "Group info" and
   *  clicking the group identity itself. */
  onOpenDetails?: () => void;
  /** Wipes this device's local cache for the room — header menu's "Clear chat". */
  onClearChat?: () => void;
  /** Removes the signed-in user from the group — header menu's "Exit group". */
  onExitGroup?: () => void;
  onForward: (message: ChatMessage) => void;
  onTogglePin: (message: ChatMessage) => void;
  onToggleKeep: (message: ChatMessage) => void;
  onDeleteForMe: (message: ChatMessage) => void;
  onDeleteForEveryone: (message: ChatMessage) => void;
}) {
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isGroupMenuOpen, setIsGroupMenuOpen] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Grows/shrinks the textarea to fit its content, capped at
  // MAX_COMPOSER_HEIGHT_PX — shared by typing (onChange) and picking an emoji.
  function autosizeComposer(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }

  // Inserts an emoji at the caret (replacing any selection), same as typing it —
  // not just appended at the end, so picking one mid-edit lands where expected.
  // Falls back to appending when the textarea ref isn't available yet.
  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    if (next.trim()) notifyTyping();
    // Runs after React flushes the new value to the DOM, so the caret restore
    // and resize act on the textarea's actual post-insert content/height.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
      autosizeComposer(el);
    });
  }

  // Reads the file picked from the hidden input, hands it to the parent
  // (which encrypts, uploads, and sends it — see DashboardShell's
  // handleSendFile), and resets the input so re-picking the same file still
  // fires onChange next time.
  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      gooeyToast.warning(
        `That file is over ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB — please pick a smaller one.`,
      );
      return;
    }
    onSendFile?.(file);
  }

  // ── DM/group resolution ─────────────────────────────────────────────────
  // Everything below renders from these instead of touching conversation/group
  // directly, so the bubbles, header, and typing UI stay identical across both
  // room kinds. In a DM every non-mine message is from the peer; in a group the
  // sender is looked up in the roster per message.
  const isGroup = group !== null;
  const title = group ? group.name : conversation ? peerName(conversation) : '';
  const chatKey = group ? group.group_id : (conversation?.peerId ?? '');
  const senderNameOf = (senderId: string): string =>
    group ? memberName(group, senderId) : conversation ? peerName(conversation) : '';
  const senderAvatarOf = (senderId: string): string | undefined =>
    group
      ? group.members.find((m) => m.user_id === senderId)?.avatar_url
      : conversation?.peerAvatarUrl;

  // Assigns each group member a name color that's unique within THIS room —
  // sorted by user id (not join order, which can shift if someone leaves and
  // rejoins) so the mapping is deterministic and never reshuffles on its own.
  // A per-sender hash (colorForSender) can't guarantee that: two people's ids
  // can hash into the same one of only 10 slots, which is exactly what showed
  // two different members' names in the same color. Colors only repeat once a
  // room has more members than the palette has colors.
  const groupSenderColors = useMemo(() => {
    const map = new Map<string, string>();
    if (!group) return map;
    const sortedIds = [...group.members.map((m) => m.user_id)].sort();
    sortedIds.forEach((id, index) => {
      map.set(id, SENDER_NAME_COLORS[index % SENDER_NAME_COLORS.length]);
    });
    return map;
  }, [group]);
  const senderColorOf = (senderId: string): string =>
    group
      ? (groupSenderColors.get(senderId) ?? SENDER_NAME_COLORS[0])
      : colorForSender(senderId);

  // Gates "Add member" in the header menu — owner/admin only, mirroring the
  // backend's requireGroupAdmin check on that call.
  const canManage =
    isGroup && canManageGroup(group!.members.find((m) => m.user_id === myUserId)?.role);

  // Group typing line, WhatsApp-style: name one or two composers, then summarise.
  const groupTypingLabel =
    isGroup && typingNames.length > 0
      ? typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : typingNames.length === 2
          ? `${typingNames[0]} and ${typingNames[1]} are typing…`
          : `${typingNames[0]} and ${typingNames.length - 1} others are typing…`
      : null;
  const someoneIsTyping = isGroup ? groupTypingLabel !== null : isPeerTyping;

  // Typing-notify bookkeeping: `typingActiveRef` tracks whether we've told the
  // peer we're typing (so we send "true" once, not per keystroke); the idle timer
  // sends "false" after a short pause. onTyping is read through a ref so these
  // handlers don't need to be recreated when its identity changes.
  const typingActiveRef = useRef(false);
  // Timestamp (ms) of the last "typing:true" we emitted, so we re-send only on the
  // heartbeat cadence rather than on every keystroke.
  const lastTypingSentRef = useRef(0);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTypingRef = useRef(onTyping);
  useEffect(() => {
    onTypingRef.current = onTyping;
  }, [onTyping]);

  function stopTyping() {
    if (typingIdleTimerRef.current) {
      clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      lastTypingSentRef.current = 0;
      onTypingRef.current(false);
    }
  }

  function notifyTyping() {
    const now = Date.now();
    // (Re)send "typing:true" on the first keystroke and then at most once per
    // heartbeat while typing continues, so the receiver's inactivity timeout is
    // continually refreshed and the indicator stays up for as long as the user
    // keeps typing — not just for one timeout window.
    if (now - lastTypingSentRef.current >= TYPING_HEARTBEAT_MS) {
      lastTypingSentRef.current = now;
      typingActiveRef.current = true;
      onTypingRef.current(true);
    }
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    // Once keystrokes stop for this long, emit "stopped" (the receiver also
    // self-clears via its own timeout as a safety net).
    typingIdleTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  // Switching rooms (or unmounting): forget our local typing state without
  // emitting to the new room — the old room's indicator self-clears via its
  // inactivity timeout.
  useEffect(() => {
    return () => {
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
      typingActiveRef.current = false;
      lastTypingSentRef.current = 0;
    };
  }, [chatKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
    // Re-scroll when the typing bubble appears so it stays in view below the
    // last message.
  }, [messages.length, someoneIsTyping]);

  // A message deleted while it was the reply target shouldn't leave a preview
  // pointing at nothing — derive the live target rather than clearing state in
  // an effect (which would trigger a cascading render).
  const activeReply =
    replyingTo && messages.some((m) => m.id === replyingTo.id) ? replyingTo : null;

  function handleSend() {
    const text = draft.trim();
    if (!text || isPeerDeleted) return;
    // Sending implies we've stopped composing — clear the peer's indicator now.
    stopTyping();
    // When a reply is active, capture a compact snapshot of the quoted message
    // so it rides inside the encrypted payload and renders as an in-bubble quote
    // on both ends. "You" stands in for our own messages.
    const replyTo: ReplyPreview | undefined = activeReply
      ? {
          messageId: activeReply.id,
          senderName: activeReply.senderId === myUserId ? 'You' : senderNameOf(activeReply.senderId),
          textPreview: previewText(activeReply.text),
        }
      : undefined;
    onSend(text, replyTo);
    setDraft('');
    setReplyingTo(null);
    // Clearing `draft` doesn't shrink the textarea's inline height style back
    // down on its own — reset it so the composer collapses to one line again.
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(message: ChatMessage) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.text);
      gooeyToast('Copied to clipboard');
    } catch {
      gooeyToast('Could not copy message', { description: 'Clipboard access was blocked.' });
    }
  }

  const actions: MessageActions = {
    onReply: (message) => {
      setReplyingTo(message);
      inputRef.current?.focus();
    },
    onCopy: (message) => void copyMessage(message),
    onForward,
    onTogglePin,
    onToggleKeep,
    onStartSelect: (message) => {
      setSelectMode(true);
      setSelectedIds(new Set([message.id]));
    },
    onReport: () => {
      gooeyToast('Message reported', {
        description: 'Thanks — our team will review it. (Demo only.)',
      });
    },
    onDeleteForMe,
    onDeleteForEveryone,
  };

  const selectedMessages = messages.filter((m) => selectedIds.has(m.id));

  function copySelected() {
    const text = selectedMessages.map((m) => m.text).join('\n');
    navigator.clipboard.writeText(text).then(
      () => gooeyToast(`Copied ${selectedMessages.length} message${selectedMessages.length === 1 ? '' : 's'}`),
      () => gooeyToast('Could not copy messages'),
    );
  }

  function deleteSelected() {
    selectedMessages.forEach((m) => onDeleteForMe(m));
    exitSelectMode();
  }

  // A deleted DM peer has no public key left to encrypt new messages to (see
  // GetUserPublicKey), so the composer is disabled outright rather than allowing a
  // send that would only fail — a deactivated peer can still be messaged normally.
  const isPeerDeleted = !isGroup && peerStatus === 'deleted';
  const canSend = Boolean(draft.trim()) && !isSending && keysReady && !isPeerDeleted;
  const pinnedMessages = messages.filter((m) => m.pinned);
  const latestPinned = pinnedMessages[pinnedMessages.length - 1];
  const replyIsMine = activeReply?.senderId === myUserId;

  // The latest of our own messages the recipient has read — the anchor for the
  // Messenger-style "seen" avatar. Messages are sorted oldest→newest, so we scan
  // from the end for the first one we sent that's marked read. Derived from the
  // per-message read status the store already tracks rather than held as extra
  // state, so it can never drift out of sync with the ticks.
  const lastReadMessageId =
    [...messages]
      .reverse()
      .find((m) => m.senderId === myUserId && m.status === 'read')?.id ?? null;

  return (
    // Crisp white canvas in light mode — the old lavender-grey gradient was the main
    // source of the "ash" cast across the app. Deep slate in dark.
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white transition-colors duration-300 ease-in-out dark:bg-gray-950">
      {/* Header — either peer identity + connection, or the selection toolbar. */}
      {selectMode ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-black/5 dark:border-white/10 bg-white/80 dark:bg-gray-900/80 transition-colors duration-300 ease-in-out px-4 py-3 backdrop-blur-sm sm:px-6">
          <button
            type="button"
            aria-label="Cancel selection"
            onClick={exitSelectMode}
            className="flex items-center justify-center rounded-full p-1.5 text-gray-500 dark:text-gray-400 transition-colors hover:bg-black/[0.05] hover:text-gray-700">
            <XMarkIcon className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {selectedIds.size} selected
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label="Copy selected"
              disabled={selectedIds.size === 0}
              onClick={copySelected}
              className="flex items-center justify-center rounded-full p-2 text-gray-500 dark:text-gray-400 transition-colors hover:bg-black/[0.05] hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">
              <Square2StackIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Delete selected for me"
              disabled={selectedIds.size === 0}
              onClick={deleteSelected}
              className="flex items-center justify-center rounded-full p-2 text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">
              <TrashIcon className="h-5 w-5" />
            </button>
          </div>
        </header>
      ) : (
        <header className="flex shrink-0 items-center gap-3 border-b border-black/5 dark:border-white/10 bg-white/70 dark:bg-gray-900/70 transition-colors duration-300 ease-in-out px-4 py-3 backdrop-blur-sm sm:px-6">
          {(() => {
            // Identity block (avatar + name + status). In a group room it's a
            // button that opens the group-details popup; in a DM it stays inert.
            const identity = (
              <>
                <Avatar
                  src={
                    group
                      ? resolveAvatarUrl(group.avatar_url)
                      : resolveAvatarUrl(conversation?.peerAvatarUrl)
                  }
                  name={title}
                  size="small"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {title}
                  </span>
                  {isGroup ? (
                    // Group status line: who's composing, else the member count.
                    groupTypingLabel ? (
                      <span className="truncate text-xs font-medium text-[var(--vibe-blue)]">
                        {groupTypingLabel}
                      </span>
                    ) : (
                      <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {group!.members.length}{' '}
                        {group!.members.length === 1 ? 'member' : 'members'}
                      </span>
                    )
                  ) : /* Account status takes over the line entirely — a deactivated/deleted
                         peer has no live presence to show, so typing/online/last-seen are
                         all suppressed in favour of a plain status line. */
                  peerStatus === 'deleted' ? (
                    <span className="truncate text-xs font-medium text-gray-500 dark:text-gray-400">
                      Account deleted
                    </span>
                  ) : peerStatus === 'deactivated' ? (
                    <span className="truncate text-xs font-medium text-amber-600 dark:text-amber-400">
                      Account deactivated
                    </span>
                  ) : isPeerTyping ? (
                    <span className="text-xs font-medium text-[var(--vibe-blue)]">typing…</span>
                  ) : isPeerOnline ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-[#277a0c]">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-70" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]" />
                      </span>
                      Online
                    </span>
                  ) : (
                    <span className="truncate text-xs text-gray-500 dark:text-gray-400">{formatLastSeen(peerLastSeen)}</span>
                  )}
                </div>
              </>
            );

            return isGroup && onOpenDetails ? (
              <button
                type="button"
                onClick={onOpenDetails}
                aria-label="Open group details"
                title="Group details"
                className="-mx-2 flex min-w-0 items-center gap-3 rounded-xl px-2 py-1 text-left outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-sky-400/50 dark:hover:bg-white/10">
                {identity}
              </button>
            ) : (
              identity
            );
          })()}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Own-connection hint only when realtime is degraded — no static
                "Connected" noise in the normal (open) case. */}
            {connectionStatus !== 'open' && (
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <StatusDot
                  variant={CONNECTION_VARIANT[connectionStatus]}
                  label={CONNECTION_LABEL[connectionStatus]}
                />
                {CONNECTION_LABEL[connectionStatus]}
              </span>
            )}
            {isGroup && onOpenDetails && onClearChat && onExitGroup && (
              <GroupContextMenu
                isOpen={isGroupMenuOpen}
                onOpenChange={setIsGroupMenuOpen}
                canAddMember={canManage}
                onAddMember={() => onInviteMember?.()}
                onGroupInfo={onOpenDetails}
                onClearChat={onClearChat}
                onExitGroup={onExitGroup}
              />
            )}
          </div>
        </header>
      )}

      {/* Pinned-message banner — shows the most recent pin for the room. */}
      {latestPinned && !selectMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/60 transition-colors duration-300 ease-in-out px-4 py-2 backdrop-blur-sm sm:px-6">
          <MapPinSolidIcon className="h-4 w-4 shrink-0 text-[var(--vibe-blue)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Pinned{pinnedMessages.length > 1 ? ` · ${pinnedMessages.length}` : ''}
            </p>
            <p className="truncate text-xs text-gray-600 dark:text-gray-300">{previewText(latestPinned.text)}</p>
          </div>
          <button
            type="button"
            aria-label="Unpin message"
            onClick={() => onTogglePin(latestPinned)}
            className="flex shrink-0 items-center justify-center rounded-full p-1.5 text-gray-400 dark:text-gray-500 transition-colors hover:bg-black/[0.05] hover:text-gray-600">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Scrolling message region — the only scrollable area. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              No messages yet. Say hello — messages are encrypted on your device
              before they&apos;re sent.
            </p>
          )}

          {messages.map((message, index) => {
            const isMine = message.senderId === myUserId;
            const prev = messages[index - 1];
            // A centered date chip precedes the first message and any message
            // that starts a new calendar day.
            const showDay = !prev || !isSameDay(prev.timestamp, message.timestamp);

            return (
              <Fragment key={message.id}>
                {showDay && (
                  <div className="flex justify-center py-1">
                    <span className="rounded-full bg-white/70 dark:bg-gray-900/70 transition-colors duration-300 ease-in-out px-3 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-sm">
                      {dayLabel(message.timestamp)}
                    </span>
                  </div>
                )}

                {message.isSystem ? (
                  // Group activity notice ("X made Y an admin") — a centered,
                  // non-interactive pill rather than a bubble: no sender
                  // identity, no context menu, nothing to reply to or select.
                  <div className="flex justify-center py-1">
                    <span className="max-w-[85%] rounded-full bg-black/[0.04] px-3 py-1 text-center text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                      {message.text}
                      <span className="ml-1.5 text-gray-400 dark:text-gray-500">
                        · {formatTime(message.timestamp)}
                      </span>
                    </span>
                  </div>
                ) : (
                  <MessageRow
                    message={message}
                    isMine={isMine}
                    senderName={senderNameOf(message.senderId)}
                    senderAvatarUrl={senderAvatarOf(message.senderId)}
                    senderColor={senderColorOf(message.senderId)}
                    readReceiptName={conversation ? peerName(conversation) : undefined}
                    readReceiptAvatarUrl={conversation?.peerAvatarUrl}
                    actions={actions}
                    menuOpen={openMenuId === message.id}
                    onMenuOpenChange={(open) => setOpenMenuId(open ? message.id : null)}
                    selectMode={selectMode}
                    isSelected={selectedIds.has(message.id)}
                    onToggleSelect={toggleSelect}
                    // Read receipts are DM-only; group rooms have no read frames.
                    showReadReceipt={!isGroup && isMine && message.id === lastReadMessageId}
                  />
                )}
              </Fragment>
            );
          })}

          {/* Typing indicator — appears as an incoming bubble after the last
              message while the peer (or a fellow group member) is composing. */}
          <AnimatePresence>
            {someoneIsTyping && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="flex origin-bottom-left items-end gap-2">
                <Avatar
                  src={
                    isGroup
                      ? resolveAvatarUrl(senderAvatarOf(typingUserIds[0] ?? ''))
                      : resolveAvatarUrl(conversation?.peerAvatarUrl)
                  }
                  name={isGroup ? typingNames[0] : conversation ? peerName(conversation) : ''}
                  size="small"
                />
                <TypingIndicator
                  label={isGroup ? typingNames.join(', ') : conversation ? peerName(conversation) : ''}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer — pinned at the bottom, floating pill container. Hidden while
          multi-select is active, since the toolbar owns actions then. */}
      {!selectMode && (
        <div className="shrink-0 px-4 pb-5 pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {sendError && (
              <p className="mb-2 px-3 text-xs text-red-600 dark:text-red-400">{sendError}</p>
            )}

            {/* Reply preview — sits directly above the input and pushes the
                history up naturally (it's part of the shrink-0 composer, not an
                overlay), so the scroll layout stays intact. */}
            {activeReply && (
              <div className="mb-2 flex items-stretch gap-2 rounded-2xl bg-white/90 dark:bg-gray-900/90 transition-colors duration-300 ease-in-out p-2 pl-3 shadow-[0_4px_16px_rgba(37,63,132,0.08)] ring-1 ring-black/[0.04]">
                <span className="w-1 shrink-0 rounded-full bg-[var(--vibe-blue)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--vibe-blue)]">
                    Replying to {replyIsMine ? 'yourself' : senderNameOf(activeReply.senderId)}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">{previewText(activeReply.text)}</p>
                </div>
                <button
                  type="button"
                  aria-label="Cancel reply"
                  onClick={() => setReplyingTo(null)}
                  className="flex shrink-0 items-center justify-center rounded-full p-1.5 text-gray-400 dark:text-gray-500 transition-colors hover:bg-black/[0.05] hover:text-gray-600">
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            )}

            <form
              className={[
                'flex items-end gap-1.5 bg-white dark:bg-gray-900 p-1.5 pl-3 shadow-[0_8px_30px_rgba(37,63,132,0.12)] ring-1 ring-black/[0.04]',
                // A tall, wrapped/pasted draft (a code block, say) reads oddly
                // inside a fully-pill-shaped container — ease the rounding off
                // once it grows past one line, same as WhatsApp/Slack/Telegram.
                draft.includes('\n') ? 'rounded-3xl' : 'rounded-full',
              ].join(' ')}
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}>
              <Popover
                isOpen={isEmojiPickerOpen}
                onOpenChange={setIsEmojiPickerOpen}
                isEnabled={!isPeerDeleted}
                label="Emoji picker"
                placement="above"
                alignment="start"
                content={
                  <EmojiPicker
                    onSelect={(emoji) => {
                      insertEmoji(emoji);
                      setIsEmojiPickerOpen(false);
                    }}
                  />
                }>
                <button
                  type="button"
                  aria-label="Add emoji"
                  disabled={isPeerDeleted}
                  className="flex shrink-0 items-center justify-center rounded-full p-1.5 text-gray-400 dark:text-gray-500 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-gray-400">
                  <FaceSmileIcon className="h-6 w-6" />
                </button>
              </Popover>

              {/* A <textarea>, not an <input> — a single-line input silently
                  strips newlines, which is exactly why pasting anything
                  multi-line (a code snippet, a list) used to collapse onto one
                  line. Enter sends; Shift+Enter inserts a newline. */}
              <textarea
                ref={inputRef}
                rows={1}
                aria-label="Message"
                disabled={isPeerDeleted}
                placeholder={
                  isPeerDeleted
                    ? 'This account has been deleted'
                    : !keysReady
                      ? 'Setting up encryption…'
                      : activeReply
                        ? 'Type your reply…'
                        : `Message ${title}`
                }
                value={draft}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value);
                  if (value.trim()) notifyTyping();
                  else stopTyping();

                  // Auto-grow to fit the content, capped so a huge paste
                  // scrolls inside the box instead of swallowing the screen.
                  autosizeComposer(event.target);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                onBlur={stopTyping}
                className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:placeholder:text-gray-400"
                style={{ maxHeight: MAX_COMPOSER_HEIGHT_PX }}
              />

              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                onChange={handleFileSelected}
              />
              <button
                type="button"
                aria-label="Attach file"
                disabled={isPeerDeleted || !onSendFile}
                onClick={() => fileInputRef.current?.click()}
                className="flex shrink-0 items-center justify-center rounded-full p-1.5 text-gray-400 dark:text-gray-500 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-gray-400">
                <PaperClipIcon className="h-6 w-6" />
              </button>

              <button
                type="submit"
                aria-label="Send message"
                disabled={!canSend}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--vibe-blue)] text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700">
                <PaperAirplaneIcon className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
