// VibeNet — pending group invitations.
//
// A main-pane view (rendered in place of the chat, like ContactsView) listing
// the invitations waiting on the signed-in user. Accepting hands the invite
// back to DashboardShell, which calls POST /api/invites/accept, unwraps the
// group key it returns, and drops the user straight into the group. Declining
// simply dismisses the row. Data + mutations live in the parent; this is
// presentation only.

'use client';

import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import { resolveAvatarUrl } from '@/lib/api';
import type { GroupInvite } from '@/lib/groups';

// Human "when" for an invite, coarse on purpose — "Just now", "2h ago", "3d ago".
function formatInvitedAt(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function InvitesView({
  invites,
  isLoading,
  busyInviteId,
  onAccept,
  onDecline,
}: {
  invites: GroupInvite[];
  /** True while the initial invite list is being fetched. */
  isLoading: boolean;
  /** The invite currently being accepted/declined — disables its buttons. */
  busyInviteId: string | null;
  onAccept: (invite: GroupInvite) => void;
  onDecline: (invite: GroupInvite) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white/40 dark:bg-slate-900/30">
      <header className="shrink-0 border-b border-black/5 bg-white/70 px-5 pb-4 pt-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 sm:px-6">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Invites
          </h1>
          {invites.length > 0 && (
            <span className="pb-0.5 text-sm text-gray-500 dark:text-gray-400">
              {invites.length} pending
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Group invitations waiting on you. Accepting adds the group to your sidebar.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {isLoading ? (
          <p className="mt-10 text-center text-sm text-gray-500 dark:text-gray-400">
            Loading invites…
          </p>
        ) : invites.length === 0 ? (
          <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-dashed border-black/10 bg-white/50 px-6 py-12 text-center dark:border-white/10 dark:bg-white/5">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-sky-600 dark:from-sky-500/20 dark:to-indigo-500/20 dark:text-sky-300">
              <UserGroupIcon className="h-7 w-7" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              No pending invites
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              When someone invites you to a group, it shows up here.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-2 pt-2">
            {invites.map((invite) => {
              const isBusy = busyInviteId === invite.invite_id;
              return (
                <div
                  key={invite.invite_id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/[0.04] dark:bg-gray-900 dark:ring-white/10">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      src={resolveAvatarUrl(invite.from_avatar_url)}
                      name={invite.from_display_name}
                      size={40}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold text-gray-900 dark:text-white">
                        {invite.group_name}
                      </span>
                      <span className="truncate text-sm text-gray-500 dark:text-gray-400">
                        Invited by {invite.from_display_name} · {formatInvitedAt(invite.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      label="Decline"
                      variant="ghost"
                      size="sm"
                      isDisabled={isBusy || busyInviteId !== null}
                      onClick={() => onDecline(invite)}
                    />
                    <Button
                      label="Accept"
                      variant="primary"
                      size="sm"
                      isLoading={isBusy}
                      isDisabled={busyInviteId !== null}
                      onClick={() => onAccept(invite)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
