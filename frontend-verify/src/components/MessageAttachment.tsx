// VibeNet — renders an E2EE file/image attachment inside a message bubble.
//
// Fetches the ciphertext from S3 (via a freshly-minted presigned GET URL —
// see lib/upload.ts) and decrypts it client-side with the AES key/IV carried
// in the message's own encrypted envelope (see lib/messageStore.ts's
// MessageFileMeta) every time it mounts. Shows a "Decrypting…" skeleton while
// that's in flight, then either an inline image or a generic file/download
// card. The resulting blob: URL is revoked on unmount so scrolling a long
// history doesn't leak memory one object URL at a time.
//
// Images render edge-to-edge (no bubble padding/background — see ChatView's
// MessageRow, which drops its own chrome for image messages) with the
// timestamp/ticks overlaid on a bottom scrim, WhatsApp/Instagram-style,
// instead of sitting in the normal text-row below the bubble.

'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Spinner } from '@astryxdesign/core/Spinner';
import {
  ArrowDownTrayIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  BookmarkIcon as BookmarkSolidIcon,
  MapPinIcon as MapPinSolidIcon,
} from '@heroicons/react/24/solid';
import { decryptFile } from '@/lib/fileCrypto';
import type { MessageFileMeta, MessageStatus } from '@/lib/messageStore';
import { fetchEncryptedBlob, requestDownloadUrl } from '@/lib/upload';
import { DeliveryTicks } from './DeliveryTicks';

type AttachmentState =
  | { status: 'loading' }
  | { status: 'ready'; objectUrl: string }
  | { status: 'error' };

// Human-readable file size, e.g. "482 KB" / "3.4 MB" — shown before/while
// decrypting, since the plaintext size is known upfront from MessageFileMeta.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function MessageAttachment({
  file,
  tone,
  timestamp,
  status,
  isKept,
  isPinned,
}: {
  file: MessageFileMeta;
  tone: 'sender' | 'receiver';
  /** Sent time, shown in the overlay once an image has finished decrypting. */
  timestamp: number;
  /** Delivery ticks — sender's own image bubbles only. */
  status?: MessageStatus;
  isKept?: boolean;
  isPinned?: boolean;
}) {
  const [state, setState] = useState<AttachmentState>({ status: 'loading' });
  const isSender = tone === 'sender';
  const isImage = file.mimeType.startsWith('image/');
  // Matches the bubble's own asymmetric corner (see MessageRow) so an
  // edge-to-edge image reads as the bubble itself, not a rectangle dropped
  // inside it.
  const bubbleCorner = isSender ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-tl-md';

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState is post-await, not synchronous
    setState({ status: 'loading' });

    void (async () => {
      try {
        const downloadUrl = await requestDownloadUrl(file.key);
        const ciphertext = await fetchEncryptedBlob(downloadUrl);
        const blob = await decryptFile(ciphertext, file.keyB64, file.ivB64, file.mimeType);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', objectUrl: createdUrl });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file.key, file.keyB64, file.ivB64, file.mimeType]);

  // Shared bottom-scrim overlay for a ready image: name badge omitted (the
  // photo speaks for itself) — just the kept/pinned marks, time, and ticks,
  // exactly what the normal text row shows, just laid over the photo instead
  // of below it.
  const overlay = (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2.5 pb-1.5 pt-6 text-[11px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
      {isKept && <BookmarkSolidIcon className="h-3 w-3 text-white" aria-label="Kept" />}
      {isPinned && <MapPinSolidIcon className="h-3 w-3 text-white" aria-label="Pinned" />}
      {formatTime(timestamp)}
      {isSender && status && <DeliveryTicks status={status} />}
    </div>
  );

  if (state.status === 'loading') {
    if (!isImage) {
      return (
        <div
          className={`mb-1 flex w-56 items-center gap-2.5 rounded-xl p-3 text-xs ${isSender ? 'bg-white/10 text-white' : 'bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300'}`}>
          <Spinner size="sm" shade={isSender ? 'onMedia' : 'default'} />
          <span className="min-w-0 flex-1 truncate">Decrypting {file.name}…</span>
        </div>
      );
    }
    return (
      <div className={`relative flex h-64 w-64 items-center justify-center overflow-hidden ${bubbleCorner}`}>
        <Skeleton width="100%" height="100%" radius={3} />
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${isSender ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`}>
          <Spinner size="sm" shade={isSender ? 'onMedia' : 'default'} />
          <span className="text-xs font-medium">Decrypting…</span>
          <span className="text-[11px] opacity-75">{formatBytes(file.size)}</span>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div
        className={`mb-1 flex w-56 items-center gap-2 rounded-xl p-3 text-xs ${isSender ? 'bg-white/10 text-white' : 'bg-black/5 text-gray-600 dark:bg-white/10 dark:text-gray-300'}`}>
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
        Couldn&apos;t decrypt this attachment.
      </div>
    );
  }

  if (isImage) {
    return (
      <a
        href={state.objectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`relative block overflow-hidden ${bubbleCorner}`}>
        {/* A blob: URL can't be optimized by next/image (no server to fetch it
            from) — a plain <img> is the documented approach for client-generated
            object URLs. Natural aspect ratio, just capped — no forced crop. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.objectUrl} alt={file.name} className="block max-h-96 max-w-[280px]" />
        {overlay}
      </a>
    );
  }

  const cardTone = isSender
    ? 'bg-white/10 text-white hover:bg-white/15'
    : 'bg-black/5 text-gray-700 hover:bg-black/[0.07] dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15';

  return (
    <a
      href={state.objectUrl}
      download={file.name}
      className={`mb-1 flex w-56 items-center gap-2.5 rounded-xl p-3 transition-colors ${cardTone}`}>
      <DocumentIcon className="h-8 w-8 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span className={`block text-xs ${isSender ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}>
          {formatBytes(file.size)}
        </span>
      </span>
      <ArrowDownTrayIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
    </a>
  );
}
