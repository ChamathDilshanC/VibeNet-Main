// VibeNet — per-message context menu (WhatsApp Web style).
//
// A ghost chevron trigger that reveals on bubble hover, opening an Astryx
// DropdownMenu popover with the message actions: Reply, Copy, Forward, Pin,
// Keep, Select, Report and Delete. Delete opens an inline submenu (Delete for
// me / Delete for everyone) rather than closing straight to a destructive
// action — "Delete for everyone" only shows on the user's own messages.
//
// All side effects (clipboard, crypto re-encryption, WebSocket frames, local
// cache mutations) live in the parent — this component is trigger + menu only.

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  BookmarkIcon,
  BookmarkSlashIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  FlagIcon,
  MapPinIcon,
  Square2StackIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { ChatMessage } from '@/lib/messageStore';

type MenuView = 'main' | 'delete';

// A single row in the popover. Rendered as a real role="menuitem" button so the
// DropdownMenu's built-in arrow-key / typeahead focus management picks it up.
function MenuButton({
  icon,
  label,
  onClick,
  tone = 'default',
  endContent,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  endContent?: ReactNode;
}) {
  const isDanger = tone === 'danger';
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3 rounded-[7px] px-2.5 py-1.5 text-left text-sm outline-none transition-colors',
        'hover:bg-[var(--color-overlay-hover)] focus-visible:bg-[var(--color-overlay-hover)]',
        isDanger ? 'text-red-600' : 'text-[var(--color-text-primary)]',
      ].join(' ')}>
      <Icon icon={icon} size="sm" color={isDanger ? 'error' : 'secondary'} />
      <span className="flex-1 truncate">{label}</span>
      {endContent}
    </button>
  );
}

export function MessageContextMenu({
  message,
  isMine,
  isOpen,
  onOpenChange,
  onReply,
  onCopy,
  onForward,
  onTogglePin,
  onToggleKeep,
  onSelect,
  onReport,
  onDeleteForMe,
  onDeleteForEveryone,
}: {
  message: ChatMessage;
  isMine: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onReply: () => void;
  onCopy: () => void;
  onForward: () => void;
  onTogglePin: () => void;
  onToggleKeep: () => void;
  onSelect: () => void;
  onReport: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
}) {
  const [view, setView] = useState<MenuView>('main');

  // Any open/close transition returns to the main view, so the menu never
  // reopens still showing the delete submenu. Resetting here (an event-driven
  // callback) rather than in an effect avoids a cascading re-render. Navigating
  // into the delete submenu is a plain in-menu click that doesn't fire this.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setView('main');
      onOpenChange(open);
    },
    [onOpenChange],
  );

  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  // Run an action, then close the menu.
  const run = useCallback(
    (action: () => void) => () => {
      action();
      close();
    },
    [close],
  );

  return (
    <DropdownMenu
      isMenuOpen={isOpen}
      onOpenChange={handleOpenChange}
      hasChevron={false}
      menuWidth={210}
      placement="below"
      button={{
        label: 'Message options',
        icon: <ChevronDownIcon className="h-4 w-4" />,
        isIconOnly: true,
        variant: 'ghost',
        size: 'sm',
      }}>
      {view === 'main' ? (
        <>
          <MenuButton icon={ArrowUturnLeftIcon} label="Reply" onClick={run(onReply)} />
          <MenuButton icon={Square2StackIcon} label="Copy" onClick={run(onCopy)} />
          <MenuButton icon={ArrowUturnRightIcon} label="Forward" onClick={run(onForward)} />
          <MenuButton
            icon={MapPinIcon}
            label={message.pinned ? 'Unpin' : 'Pin'}
            onClick={run(onTogglePin)}
          />
          <MenuButton
            icon={message.kept ? BookmarkSlashIcon : BookmarkIcon}
            label={message.kept ? 'Unkeep' : 'Keep'}
            onClick={run(onToggleKeep)}
          />
          <MenuButton icon={CheckCircleIcon} label="Select" onClick={run(onSelect)} />

          <div
            role="separator"
            className="my-1 h-px bg-[var(--color-border)]"
            aria-hidden="true"
          />

          <MenuButton icon={FlagIcon} label="Report" onClick={run(onReport)} />
          <MenuButton
            icon={TrashIcon}
            label="Delete"
            tone="danger"
            onClick={() => setView('delete')}
            endContent={<Icon icon={ChevronRightIcon} size="sm" color="error" />}
          />
        </>
      ) : (
        <>
          <MenuButton
            icon={ChevronLeftIcon}
            label="Back"
            onClick={() => setView('main')}
          />
          <div
            role="separator"
            className="my-1 h-px bg-[var(--color-border)]"
            aria-hidden="true"
          />
          <MenuButton
            icon={TrashIcon}
            label="Delete for me"
            tone="danger"
            onClick={run(onDeleteForMe)}
          />
          {isMine && (
            <MenuButton
              icon={TrashIcon}
              label="Delete for everyone"
              tone="danger"
              onClick={run(onDeleteForEveryone)}
            />
          )}
        </>
      )}
    </DropdownMenu>
  );
}
