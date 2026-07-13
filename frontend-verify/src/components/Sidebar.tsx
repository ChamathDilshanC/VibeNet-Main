// VibeNet — Dashboard sidebar: brand, chat navigation, direct-message list,
// and account utilities (chat PIN, settings, profile, sign out).
//
// The DM list is real — sourced from the client-side conversation registry
// (src/lib/conversations.ts). Presence is real too: `onlinePeers` holds the
// peer IDs the hub currently reports as connected (see DashboardShell's
// presence poll), so a peer shows a green dot when online and a neutral dot
// when offline.

'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Divider } from '@astryxdesign/core/Divider';
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from '@astryxdesign/core/SideNav';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import {
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlusIcon,
  ShieldCheckIcon,
  SunIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { ChevronsLeft } from 'lucide-react';
import { resolveAvatarUrl, type AuthUser } from '@/lib/api';
import { peerName, type Conversation } from '@/lib/conversations';
import type { Group } from '@/lib/groups';
import type { DashboardView } from './DashboardShell';
import type { SettingsSection } from './SettingsPanel';

// unreadBadgeLabel caps the displayed count the way WhatsApp/Telegram do, so a
// long-neglected chat's badge doesn't blow out the row width.
function unreadBadgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function Sidebar({
  user,
  conversations,
  groups,
  activePeerId,
  activeGroupId,
  pendingInviteCount,
  onlinePeers,
  unreadByPeer,
  unreadByGroup,
  onSelectConversation,
  onSelectGroup,
  onNewChat,
  onCreateGroup,
  onInvites,
  onContacts,
  onSettings,
  activeView,
  onLogout,
}: {
  user: AuthUser | null;
  conversations: Conversation[];
  groups: Group[];
  activePeerId: string | null;
  activeGroupId: string | null;
  // Number of pending group invitations — badges the "Invites" item.
  pendingInviteCount: number;
  onlinePeers: ReadonlySet<string>;
  // Unread message counts (see lib/readState), keyed by peer id / group id.
  // Missing entries render as no badge, same as 0.
  unreadByPeer: Readonly<Record<string, number>>;
  unreadByGroup: Readonly<Record<string, number>>;
  onSelectConversation: (peerId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onNewChat: () => void;
  onCreateGroup: () => void;
  onInvites: () => void;
  onContacts: () => void;
  // Swaps the main pane to settings, on the given section. These used to be links to
  // /settings; that route is gone — settings now renders in place beside this nav.
  onSettings: (section?: SettingsSection) => void;
  activeView: DashboardView;
  onLogout: () => void;
}) {
  const isSettingsActive = activeView === 'settings';

  // Collapse is controlled here (SideNav's built-in bottom button is disabled) so the
  // toggle can live in the header beside the logo instead.
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Quick light/dark flip, usable even while collapsed (icon survives; label hides).
  // The Appearance tab in Settings stays the full control (incl. "system").
  const { resolvedTheme, setTheme } = useTheme();
  // next-themes only knows the real theme after reading the DOM on the client; render
  // a stable icon until then so hydration markup matches the server's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration flag
    setMounted(true);
  }, []);
  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <SideNav
      className="vibe-sidenav"
      collapsible={{
        isCollapsed,
        onCollapsedChange: setIsCollapsed,
        hasButton: false,
      }}
      resizable={{ defaultWidth: 360, minWidth: 280, maxWidth: 480 }}
      header={
        <div className="flex items-center justify-between gap-1 px-3 py-2">
          {/* Logo can't fit the 72px collapsed rail — the chevron stands in alone. */}
          {!isCollapsed && (
            <a href="/dashboard" aria-label="VibeNet home" className="flex min-w-0 items-center">
              <img
                src="/logo/vibenet-logo.png"
                alt="VibeNet"
                width={1787}
                height={521}
                className="h-auto w-24"
              />
            </a>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed((c) => !c)}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!isCollapsed}
            className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              'text-gray-500 outline-none transition-colors duration-200',
              'hover:bg-gray-200/60 hover:text-gray-900',
              'dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-100',
              'focus-visible:ring-2 focus-visible:ring-blue-500',
              isCollapsed ? 'mx-auto' : '',
            ].join(' ')}
          >
            <ChevronsLeft
              className={
                'h-5 w-5 transition-transform duration-300 ease-in-out ' +
                (isCollapsed ? 'rotate-180' : '')
              }
              strokeWidth={1.75}
            />
          </button>
        </div>
      }
      footer={
        <SideNavSection title="Account" isHeaderHidden>
          {/* Icon-only when collapsed, so the theme stays switchable either way. The
              label reflects the action (what you'll switch TO), not the current state. */}
          <SideNavItem
            label={isDark ? 'Light mode' : 'Dark mode'}
            icon={isDark ? SunIcon : MoonIcon}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          />
          <SideNavItem
            label="Chat PIN"
            icon={ShieldCheckIcon}
            onClick={() => onSettings('security')}
          />
          <SideNavItem
            label="Settings"
            icon={Cog6ToothIcon}
            onClick={() => onSettings('profile')}
            isSelected={isSettingsActive}
          />
          <SideNavItem
            label={user?.display_name || user?.username || 'Account'}
            icon={
              <Avatar
                src={resolveAvatarUrl(user?.avatar_url)}
                name={user?.display_name || user?.username}
                size="tiny"
              />
            }
            onClick={() => onSettings('profile')}
          />
          <SideNavItem
            label="Log out"
            icon={ArrowRightStartOnRectangleIcon}
            onClick={onLogout}
          />
        </SideNavSection>
      }>
      <SideNavSection title="Menu" isHeaderHidden>
        <SideNavItem label="New chat" icon={PlusIcon} onClick={onNewChat} />
        <SideNavItem
          label="Find people"
          icon={MagnifyingGlassIcon}
          onClick={onNewChat}
        />
        <SideNavItem
          label="Contacts"
          icon={UsersIcon}
          onClick={onContacts}
          isSelected={activeView === 'contacts'}
        />
        <SideNavItem
          label="Invites"
          icon={EnvelopeIcon}
          onClick={onInvites}
          isSelected={activeView === 'invites'}
          endContent={
            pendingInviteCount > 0 ? (
              <Badge variant="info" label={String(pendingInviteCount)} />
            ) : undefined
          }
        />
      </SideNavSection>
      <Divider />
      <SideNavSection title="Groups">
        <SideNavItem label="Create group" icon={PlusIcon} onClick={onCreateGroup} />
        {groups.map((group) => {
          const unread = unreadByGroup[group.group_id] ?? 0;
          return (
            <SideNavItem
              key={group.group_id}
              label={group.name}
              icon={
                <Avatar
                  src={resolveAvatarUrl(group.avatar_url)}
                  name={group.name}
                  size="tiny"
                />
              }
              isSelected={group.group_id === activeGroupId}
              onClick={() => onSelectGroup(group.group_id)}
              endContent={
                <div className="flex items-center gap-1.5">
                  {unread > 0 && (
                    <Badge
                      variant="info"
                      label={unreadBadgeLabel(unread)}
                      aria-label={`${unread} unread ${unread === 1 ? 'message' : 'messages'}`}
                    />
                  )}
                  <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                    <UserGroupIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {group.members.length}
                  </span>
                </div>
              }
            />
          );
        })}
      </SideNavSection>
      <Divider />
      <SideNavSection title="Direct messages">
        {conversations.length === 0 ? (
          <Text type="supporting" color="secondary" className="px-3 py-2">
            No conversations yet — start one from &ldquo;New chat&rdquo;.
          </Text>
        ) : (
          conversations.map((conversation) => {
            const isOnline = onlinePeers.has(conversation.peerId);
            const name = peerName(conversation);
            const unread = unreadByPeer[conversation.peerId] ?? 0;
            return (
              <SideNavItem
                key={conversation.peerId}
                label={name}
                icon={
                  <Avatar
                    src={resolveAvatarUrl(conversation.peerAvatarUrl)}
                    name={name}
                    size="tiny"
                  />
                }
                isSelected={conversation.peerId === activePeerId}
                onClick={() => onSelectConversation(conversation.peerId)}
                endContent={
                  <div className="flex items-center gap-1.5">
                    {unread > 0 && (
                      <Badge
                        variant="info"
                        label={unreadBadgeLabel(unread)}
                        aria-label={`${unread} unread ${unread === 1 ? 'message' : 'messages'}`}
                      />
                    )}
                    <StatusDot
                      variant={isOnline ? 'success' : 'neutral'}
                      label={isOnline ? 'Online' : 'Offline'}
                    />
                  </div>
                }
              />
            );
          })
        )}
      </SideNavSection>
    </SideNav>
  );
}
