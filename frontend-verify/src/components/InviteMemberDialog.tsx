// VibeNet — invite a user into an existing group, by username search.
//
// Selection only, like NewChatDialog: picking a result hands the user back to
// DashboardShell, which wraps the group key for them and calls
// POST /api/groups/invite. Existing members are filtered out of the results.

'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { resolveAvatarUrl } from '@/lib/api';
import { apiClient } from '@/lib/apiClient';
import type { Group } from '@/lib/groups';

interface SearchResult {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
}

/** The user picked to receive a group invitation. */
export interface InviteTarget {
  userId: string;
  username: string;
  displayName?: string;
}

function resultName(user: SearchResult): string {
  const display = user.display_name?.trim();
  return display ? display : user.username;
}

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

export function InviteMemberDialog({
  isOpen,
  onOpenChange,
  group,
  isInviting,
  onInvite,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The group being invited into — used to filter out existing members. */
  group: Group | null;
  /** True while the parent is wrapping the key + calling the API. */
  isInviting: boolean;
  onInvite: (target: InviteTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const showResults = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const memberIds = new Set(group?.members.map((m) => m.user_id) ?? []);

  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;

    const timer = setTimeout(() => {
      setIsSearching(true);
      apiClient
        .get<{ results: SearchResult[] }>(
          `/api/users/search?username=${encodeURIComponent(trimmedQuery)}`,
        )
        .then((data) => {
          setResults(data.results);
          setSearchError(null);
        })
        .catch((err: unknown) => {
          setResults([]);
          setSearchError(err instanceof Error ? err.message : 'Search failed.');
        })
        .finally(() => setIsSearching(false));
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  const invitable = results.filter((u) => !memberIds.has(u.user_id));

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={420} purpose="form">
      <Layout
        height="fill"
        header={
          <DialogHeader
            title={group ? `Invite to ${group.name}` : 'Invite to group'}
            subtitle="They'll get an invitation to accept before joining"
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
                isLoading={showResults && (isSearching || isInviting)}
                hasAutoFocus
                hasClear
                isDisabled={isInviting}
              />

              {showResults && searchError && (
                <Text type="supporting" className="text-red-600 dark:text-red-400">
                  {searchError}
                </Text>
              )}

              {showResults && invitable.length > 0 && (
                <List>
                  {invitable.map((user) => (
                    <ListItem
                      key={user.user_id}
                      label={resultName(user)}
                      description={
                        resultName(user) !== user.username ? `@${user.username}` : undefined
                      }
                      startContent={
                        <Avatar
                          src={resolveAvatarUrl(user.avatar_url)}
                          name={resultName(user)}
                          size="small"
                        />
                      }
                      isDisabled={isInviting}
                      onClick={() =>
                        onInvite({
                          userId: user.user_id,
                          username: user.username,
                          displayName: user.display_name?.trim() || undefined,
                        })
                      }
                    />
                  ))}
                </List>
              )}

              {showResults && !isSearching && !searchError && invitable.length === 0 && (
                <Text type="supporting" color="secondary">
                  {results.length > 0
                    ? 'Everyone matching is already in this group.'
                    : 'No users found.'}
                </Text>
              )}
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
