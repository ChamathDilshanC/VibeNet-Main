// VibeNet — "Create group" dialog: name the group, search contacts by
// username, and pick the starting members.
//
// Selection + presentation only, mirroring NewChatDialog: the heavy lifting —
// generating the group key, wrapping it for every member, and calling
// POST /api/groups/create — happens in DashboardShell.handleCreateGroup, which
// receives the chosen name + members from here. The parent remounts this
// component (key bump) each time the dialog opens, so transient state resets
// for free.

'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { CheckIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { resolveAvatarUrl } from '@/lib/api';
import { apiClient } from '@/lib/apiClient';

interface SearchResult {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
}

/** A contact picked as a starting member of the new group. */
export interface SelectedGroupMember {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

function resultName(user: SearchResult): string {
  const display = user.display_name?.trim();
  return display ? display : user.username;
}

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_GROUP_NAME_LENGTH = 64;

export function CreateGroupDialog({
  isOpen,
  onOpenChange,
  currentUserId,
  isCreating,
  onCreate,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  currentUserId: string;
  /** True while the parent is wrapping keys + calling the API. */
  isCreating: boolean;
  onCreate: (name: string, members: SelectedGroupMember[]) => void;
}) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedGroupMember[]>([]);

  const trimmedQuery = query.trim();
  const showResults = trimmedQuery.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return;

    const timer = setTimeout(() => {
      setIsSearching(true);
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

  const selectedIds = new Set(selected.map((m) => m.userId));

  function toggleMember(user: SearchResult) {
    setSelected((prev) => {
      if (prev.some((m) => m.userId === user.user_id)) {
        return prev.filter((m) => m.userId !== user.user_id);
      }
      return [
        ...prev,
        {
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name?.trim() || undefined,
          avatarUrl: user.avatar_url,
        },
      ];
    });
  }

  function removeMember(userId: string) {
    setSelected((prev) => prev.filter((m) => m.userId !== userId));
  }

  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0 && !isCreating;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={460} purpose="form">
      <Layout
        height="fill"
        header={
          <DialogHeader
            title="Create group"
            subtitle="Name your group and add contacts — messages stay end-to-end encrypted"
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={3}>
              <TextInput
                label="Group name"
                placeholder="e.g. Weekend plans"
                value={name}
                onChange={(value) => setName(value.slice(0, MAX_GROUP_NAME_LENGTH))}
                hasAutoFocus
                isDisabled={isCreating}
              />

              <TextInput
                label="Add members"
                placeholder="Search by username"
                value={query}
                onChange={setQuery}
                startIcon={<Icon icon={MagnifyingGlassIcon} size="sm" />}
                isLoading={showResults && isSearching}
                hasClear
                isDisabled={isCreating}
              />

              {/* Selected member chips — removable until the group is created. */}
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((member) => (
                    <span
                      key={member.userId}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vibe-blue)]/10 py-1 pl-1 pr-2 text-xs font-medium text-[var(--vibe-blue)]">
                      <Avatar
                        src={resolveAvatarUrl(member.avatarUrl)}
                        name={member.displayName || member.username}
                        size="tiny"
                      />
                      <span className="max-w-[10rem] truncate">
                        {member.displayName || member.username}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${member.displayName || member.username}`}
                        disabled={isCreating}
                        onClick={() => removeMember(member.userId)}
                        className="rounded-full p-0.5 transition-colors hover:bg-[var(--vibe-blue)]/15 disabled:opacity-40">
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {showResults && searchError && (
                <Text type="supporting" className="text-red-600 dark:text-red-400">
                  {searchError}
                </Text>
              )}

              {showResults && results.length > 0 && (
                <List>
                  {results.map((user) => {
                    const isPicked = selectedIds.has(user.user_id);
                    return (
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
                        endContent={
                          isPicked ? (
                            <CheckIcon
                              className="h-5 w-5 text-[var(--vibe-blue)]"
                              aria-label="Selected"
                            />
                          ) : undefined
                        }
                        isSelected={isPicked}
                        isDisabled={isCreating}
                        onClick={() => toggleMember(user)}
                      />
                    );
                  })}
                </List>
              )}

              {showResults && !isSearching && !searchError && results.length === 0 && (
                <Text type="supporting" color="secondary">
                  No users found.
                </Text>
              )}

              <Button
                label={
                  isCreating
                    ? 'Creating…'
                    : selected.length > 0
                      ? `Create group with ${selected.length} ${selected.length === 1 ? 'member' : 'members'}`
                      : 'Create group'
                }
                variant="primary"
                isDisabled={!canCreate}
                isLoading={isCreating}
                onClick={() => onCreate(trimmedName, selected)}
              />
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
