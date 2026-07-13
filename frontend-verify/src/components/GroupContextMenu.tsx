// VibeNet — group chat header context menu (the "⋮" kebab next to a group's
// connection status).
//
// Same compound-children Astryx DropdownMenu pattern as MessageContextMenu:
// a ghost icon-only trigger opening a popover of role="menuitem" buttons. All
// side effects (API calls, local cache clears, room navigation) live in the
// parent — this is trigger + menu only.

'use client';

import { useCallback } from 'react';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import {
  ArrowRightStartOnRectangleIcon,
  EllipsisVerticalIcon,
  InformationCircleIcon,
  TrashIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';

function MenuButton({
  icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
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
    </button>
  );
}

export function GroupContextMenu({
  isOpen,
  onOpenChange,
  canAddMember,
  onAddMember,
  onGroupInfo,
  onClearChat,
  onExitGroup,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Owner/admin only — a regular member never sees "Add member" here, matching
   *  the backend's requireGroupAdmin gate on that call. */
  canAddMember: boolean;
  onAddMember: () => void;
  onGroupInfo: () => void;
  onClearChat: () => void;
  onExitGroup: () => void;
}) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Run an action, then close the menu — same helper MessageContextMenu uses.
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
      onOpenChange={onOpenChange}
      hasChevron={false}
      menuWidth={200}
      placement="below"
      button={{
        label: 'Group options',
        icon: <EllipsisVerticalIcon className="h-5 w-5" />,
        isIconOnly: true,
        variant: 'ghost',
        size: 'sm',
      }}>
      {canAddMember && (
        <MenuButton icon={UserPlusIcon} label="Add member" onClick={run(onAddMember)} />
      )}
      <MenuButton icon={InformationCircleIcon} label="Group info" onClick={run(onGroupInfo)} />
      <MenuButton icon={TrashIcon} label="Clear chat" onClick={run(onClearChat)} />

      <div role="separator" className="my-1 h-px bg-[var(--color-border)]" aria-hidden="true" />

      <MenuButton
        icon={ArrowRightStartOnRectangleIcon}
        label="Exit group"
        tone="danger"
        onClick={run(onExitGroup)}
      />
    </DropdownMenu>
  );
}
