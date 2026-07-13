// VibeNet — Empty conversation state, shown when no chat is selected.
//
// Beyond the reassurance that messages are encrypted, this surfaces the user's
// recent conversations so they can jump straight back into one without hunting
// through the sidebar. Each row shows live presence (green when online).

'use client';

import { Avatar } from '@astryxdesign/core/Avatar';
import { Text } from '@astryxdesign/core/Text';
import { resolveAvatarUrl } from '@/lib/api';
import { peerName, type Conversation } from '@/lib/conversations';

const MAX_RECENT = 6;

export function EmptyState({
  conversations,
  onlinePeers,
  onSelect,
}: {
  conversations: Conversation[];
  onlinePeers: ReadonlySet<string>;
  onSelect: (peerId: string) => void;
}) {
  // conversations already arrive newest-first (see listConversations).
  const recent = conversations.slice(0, MAX_RECENT);

  return (
    <div className="mt-8 flex w-full max-w-md flex-col gap-6">
      <div className="vibe-empty">
        <Text type="large" weight="bold">
          No conversation selected
        </Text>
        <Text type="supporting" color="secondary">
          Messages are encrypted on your device — only you and your contact can
          read them.
        </Text>
      </div>

      {recent.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Recent chats
          </p>
          <ul className="flex flex-col gap-1">
            {recent.map((conversation) => {
              const isOnline = onlinePeers.has(conversation.peerId);
              // Real name first, username as the fallback (peerName handles both).
              const name = peerName(conversation);
              return (
                <li key={conversation.peerId}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.peerId)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
                    <Avatar
                      src={resolveAvatarUrl(conversation.peerAvatarUrl)}
                      name={name}
                      size="small"
                    />
                    <span className="flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                      {name}
                    </span>
                    <span
                      role="img"
                      aria-label={isOnline ? 'Online' : 'Offline'}
                      className={`h-2.5 w-2.5 rounded-full ${
                        isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-700'
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
