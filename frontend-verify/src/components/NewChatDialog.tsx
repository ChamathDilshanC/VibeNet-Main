// VibeNet — "New chat" search dialog.
//
// Search is the only discovery mechanism the backend exposes (GET
// /api/users/search?username=), so this dialog doubles as the target for both
// the sidebar's "New chat" and "Find people" actions. Selecting a result fetches
// their E2EE public key (GET /api/users/{id}/key) and hands the resolved peer back
// to the caller to open as a conversation. The chat PIN is single-sided — the
// current user's own unlock happens in DashboardShell when the room opens, so this
// dialog no longer deals with PINs.

'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ShieldCheckIcon } from '@heroicons/react/24/solid';
import { gooeyToast } from 'goey-toast';
import { resolveAvatarUrl } from '@/lib/api';
import { apiClient } from '@/lib/apiClient';

interface SearchResult {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  /** Whether starting a chat with this user requires entering THEIR chat PIN.
   *  Surfaced in the result row (shield + "PIN Required") and drives the PIN gate. */
  chat_pin_enabled?: boolean;
}

export interface ResolvedPeer {
  userId: string;
  username: string;
  displayName?: string;
  publicKey: string;
  avatarUrl?: string;
  /** Carries the target's PIN requirement to the caller so it can gate the room
   *  on the recipient's PIN before opening. */
  chatPinEnabled?: boolean;
}

// The name to show for a search hit: the real name when present, else the handle.
function resultName(user: SearchResult): string {
  const display = user.display_name?.trim();
  return display ? display : user.username;
}

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

export function NewChatDialog({
  isOpen,
  onOpenChange,
  currentUserId,
  onStart,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  currentUserId: string;
  onStart: (peer: ResolvedPeer) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const resultItemRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Below this length we neither fetch nor show stale results — see the
  // `showResults` render gate below. Transient state otherwise resets for
  // free: the parent remounts this component (via a `key` bump) each time
  // "New chat" is reopened, rather than an effect clearing fields on close.
  const trimmedQuery = query.trim();
  const showResults = trimmedQuery.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;

    setIsSearching(true);
    const timer = setTimeout(() => {
      apiClient
        .get<{ results: SearchResult[] }>(
          `/api/users/search?username=${encodeURIComponent(trimmedQuery)}`,
        )
        .then((data) => {
          setResults(data.results.filter((u) => u.user_id !== currentUserId));
          setSearchError(null);
        })
        .catch((err: unknown) => {
          setResults([]);
          setSearchError(err instanceof Error ? err.message : 'Search failed.');
        })
        .finally(() => setIsSearching(false));
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmedQuery, currentUserId]);

  useEffect(() => {
    setActiveIndex(-1);
    resultItemRefs.current = [];
  }, [results]);

  useEffect(() => {
    if (activeIndex < 0) return;
    resultItemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  async function resolvePeer(user: SearchResult) {
    setIsStarting(true);
    try {
      const data = await apiClient.get<{
        user_id: string;
        display_name?: string;
        public_key: string;
        avatar_url?: string;
      }>(`/api/users/${user.user_id}/key`);
      onStart({
        userId: user.user_id,
        username: user.username,
        // The key response is authoritative for name + avatar; fall back to the
        // search hit, then the username, so a name is always present.
        displayName: data.display_name ?? user.display_name ?? user.username,
        publicKey: data.public_key,
        avatarUrl: data.avatar_url ?? user.avatar_url,
        // The key endpoint doesn't carry the PIN flag; the search hit is the
        // authoritative source for whether this target is PIN-protected.
        chatPinEnabled: user.chat_pin_enabled,
      });
    } catch (err) {
      gooeyToast.error(err instanceof Error ? err.message : 'Could not start this chat.');
    } finally {
      setIsStarting(false);
    }
  }

  function handleSelect(user: SearchResult) {
    if (isStarting) return;
    // Close the search dialog immediately so the PIN gate (or chat room) can
    // open on top without stacking two modals.
    onOpenChange(false);
    void resolvePeer(user);
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showResults || results.length === 0 || isStarting) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i < results.length - 1 ? i + 1 : 0));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
      return;
    }

    if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]!);
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={420} purpose="form">
      <Layout
        height="fill"
        header={
          <DialogHeader
            title="New chat"
            subtitle="Find someone by username to start an encrypted conversation"
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={3}>
              <TextInput
                label="Search by username"
                isLabelHidden
                placeholder="Search by username"
                value={query}
                onChange={setQuery}
                startIcon={<Icon icon={MagnifyingGlassIcon} size="sm" />}
                isLoading={showResults && (isSearching || isStarting)}
                hasAutoFocus
                hasClear
                onKeyDown={handleSearchKeyDown}
              />

              {showResults && searchError && (
                <Text type="supporting" className="text-red-600 dark:text-red-400">
                  {searchError}
                </Text>
              )}

              {showResults && results.length > 0 && (
                <List>
                  {results.map((user, index) => (
                    <ListItem
                      key={user.user_id}
                      ref={(el) => {
                        resultItemRefs.current[index] = el;
                      }}
                      label={
                        user.chat_pin_enabled ? (
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{resultName(user)}</span>
                            <span
                              className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20"
                              title="This user requires their chat PIN to start a conversation">
                              <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden />
                              PIN Required
                            </span>
                          </span>
                        ) : (
                          resultName(user)
                        )
                      }
                      description={
                        resultName(user) !== user.username ? `@${user.username}` : undefined
                      }
                      startContent={<Avatar src={resolveAvatarUrl(user.avatar_url)} name={resultName(user)} size="small" />}
                      isSelected={index === activeIndex}
                      isDisabled={isStarting}
                      onClick={() => handleSelect(user)}
                    />
                  ))}
                </List>
              )}

              {showResults && !isSearching && !searchError && results.length === 0 && (
                <Text type="supporting" color="secondary">
                  No users found.
                </Text>
              )}
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
