// VibeNet — group details popup, opened by clicking the group chat header.
//
// Shows the group photo (click to upload a new one), an editable group name,
// creation date, and the member roster with role badges. Mutations live in
// DashboardShell (onRename / onUploadPhoto / onUpdateRole call the API and
// refresh state); this component is presentation + local edit state only,
// like the other dialogs.
//
// Renaming and the photo stay open to any member (matches the invite policy
// before roles existed). Member MANAGEMENT — inviting, and promoting/demoting
// between admin and member — is gated to the owner and admins, mirroring the
// backend's requireGroupAdmin check exactly (see lib/groups canManageGroup).

'use client';

import { useRef, useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { CameraIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { resolveAvatarUrl } from '@/lib/api';
import { canManageGroup, type Group, type GroupRole } from '@/lib/groups';

const MAX_GROUP_NAME_LENGTH = 64;

// Accepted photo types — mirrors the backend's sniffed allow-list.
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

function memberLabel(member: Group['members'][number]): string {
  return member.display_name.trim() || member.username;
}

// Role badge — blue for the owner, a distinct purple for admins, nothing for
// a plain member (an unbadged row already reads as "regular member").
function RoleBadge({ role }: { role: GroupRole }) {
  if (role === 'owner') return <Badge variant="info" label="Owner" />;
  if (role === 'admin') return <Badge variant="purple" label="Admin" />;
  return null;
}

export function GroupDetailsDialog({
  isOpen,
  onOpenChange,
  group,
  currentUserId,
  isSavingName,
  isUploadingPhoto,
  updatingRoleUserId,
  removingMemberUserId,
  onRename,
  onUploadPhoto,
  onInviteMember,
  onUpdateRole,
  onRemoveMember,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  group: Group | null;
  currentUserId: string;
  /** True while a rename is in flight — disables the Save button. */
  isSavingName: boolean;
  /** True while a photo upload is in flight — overlays the avatar. */
  isUploadingPhoto: boolean;
  /** The member row currently being promoted/demoted — disables its action. */
  updatingRoleUserId: string | null;
  /** The member row currently being removed — disables its action. */
  removingMemberUserId: string | null;
  onRename: (name: string) => void;
  onUploadPhoto: (file: File) => void;
  /** Jumps to the existing invite dialog. Owner/admin only — see canManageGroup. */
  onInviteMember: () => void;
  /** Promotes a member to admin or demotes an admin back to member. */
  onUpdateRole: (userId: string, role: 'admin' | 'member') => void;
  /** Removes a member from the group entirely. */
  onRemoveMember: (userId: string) => void;
}) {
  // Local draft of the name; null means "not edited yet — mirror the group".
  // Kept as a draft (not synced via effect) so a live group_update refetch
  // doesn't clobber what the user is typing.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!group) return null;

  const myRole = group.members.find((m) => m.user_id === currentUserId)?.role;
  const canManage = canManageGroup(myRole);

  const name = nameDraft ?? group.name;
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== group.name && trimmedName.length > 0;

  function handlePickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so picking the same file again still fires onChange.
    event.target.value = '';
    if (file) onUploadPhoto(file);
  }

  const createdOn = new Date(group.created_at).toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={640} purpose="form">
      <Layout
        height="fill"
        header={
          <DialogHeader
            title="Group details"
            subtitle={`Created on ${createdOn}`}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              {/* Photo + name, side by side. The avatar doubles as the upload
                  trigger, with a camera overlay to make that discoverable. */}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  aria-label="Change group photo"
                  title="Change group photo"
                  disabled={isUploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60">
                  <Avatar src={resolveAvatarUrl(group.avatar_url)} name={group.name} size={72} />
                  <span
                    className={[
                      'absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white transition-opacity',
                      isUploadingPhoto
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                    ].join(' ')}>
                    {isUploadingPhoto ? (
                      <span className="text-xs font-medium">Uploading…</span>
                    ) : (
                      <CameraIcon className="h-6 w-6" aria-hidden="true" />
                    )}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  className="hidden"
                  onChange={handlePickPhoto}
                />

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <TextInput
                    label="Group name"
                    value={name}
                    onChange={(value) => setNameDraft(value.slice(0, MAX_GROUP_NAME_LENGTH))}
                    isDisabled={isSavingName}
                  />
                  {nameChanged && (
                    <Button
                      label={isSavingName ? 'Saving…' : 'Save name'}
                      variant="primary"
                      size="sm"
                      isLoading={isSavingName}
                      onClick={() => onRename(trimmedName)}
                    />
                  )}
                </div>
              </div>

              {/* Member roster */}
              <VStack gap={2}>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary">
                    {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
                  </Text>
                  {/* Owner/admin only — a regular member has no way to add people,
                      matching the backend's requireGroupAdmin gate on this call. */}
                  {canManage && (
                    <Button
                      label="Invite"
                      variant="ghost"
                      size="sm"
                      icon={<UserPlusIcon className="h-4 w-4" aria-hidden="true" />}
                      onClick={onInviteMember}
                    />
                  )}
                </div>
                <List>
                  {group.members.map((member) => {
                    // Promote/demote is only offered when the viewer can manage
                    // the group, the target isn't the immutable owner, and it
                    // isn't the viewer's own row (no self-service role changes).
                    const canActOnMember =
                      canManage && member.role !== 'owner' && member.user_id !== currentUserId;
                    const isUpdating = updatingRoleUserId === member.user_id;

                    // Removing is a step further than demoting: any owner/admin
                    // may remove a regular member, but an admin can't remove a
                    // fellow admin — only the owner can. Mirrors the backend's
                    // RemoveGroupMember check exactly.
                    const canRemoveMember =
                      canActOnMember && (member.role !== 'admin' || myRole === 'owner');
                    const isRemoving = removingMemberUserId === member.user_id;
                    const rowBusy = updatingRoleUserId !== null || removingMemberUserId !== null;

                    return (
                      <ListItem
                        key={member.user_id}
                        label={
                          member.user_id === currentUserId
                            ? `${memberLabel(member)} (you)`
                            : memberLabel(member)
                        }
                        description={`@${member.username}`}
                        startContent={
                          <Avatar
                            src={resolveAvatarUrl(member.avatar_url)}
                            name={memberLabel(member)}
                            size="small"
                          />
                        }
                        endContent={
                          <div className="flex items-center gap-2">
                            <RoleBadge role={member.role} />
                            {canActOnMember && (
                              <Button
                                label={
                                  isUpdating
                                    ? 'Saving…'
                                    : member.role === 'admin'
                                      ? 'Remove admin'
                                      : 'Make admin'
                                }
                                variant="ghost"
                                size="sm"
                                isLoading={isUpdating}
                                isDisabled={rowBusy}
                                onClick={() =>
                                  onUpdateRole(
                                    member.user_id,
                                    member.role === 'admin' ? 'member' : 'admin',
                                  )
                                }
                              />
                            )}
                            {canRemoveMember && (
                              <Button
                                label={isRemoving ? 'Removing…' : 'Remove'}
                                variant="destructive"
                                size="sm"
                                isLoading={isRemoving}
                                isDisabled={rowBusy}
                                onClick={() => onRemoveMember(member.user_id)}
                              />
                            )}
                          </div>
                        }
                      />
                    );
                  })}
                </List>
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
