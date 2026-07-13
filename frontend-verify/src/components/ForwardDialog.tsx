// VibeNet — "Forward message" contact picker.
//
// Forwarding is end-to-end encrypted per recipient: the message is already
// decrypted in local state, so picking a contact hands their peerId back to the
// parent, which derives that contact's shared key, RE-ENCRYPTS the plaintext
// under it, and sends fresh ciphertext over the WebSocket. Nothing here touches
// crypto — this is selection + preview only.

'use client';

import { useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { resolveAvatarUrl } from '@/lib/api';
import { peerName, type Conversation } from '@/lib/conversations';

export function ForwardDialog({
  isOpen,
  onOpenChange,
  conversations,
  messagePreview,
  onForward,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  conversations: Conversation[];
  /** The plaintext being forwarded — shown as a preview so the user can confirm. */
  messagePreview: string;
  onForward: (peerId: string) => void | Promise<void>;
}) {
  const [forwardingTo, setForwardingTo] = useState<string | null>(null);

  async function handlePick(peerId: string) {
    setForwardingTo(peerId);
    try {
      await onForward(peerId);
      onOpenChange(false);
    } finally {
      setForwardingTo(null);
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={420} purpose="form">
      <Layout
        height="fill"
        header={
          <DialogHeader
            title="Forward message"
            subtitle="Pick a contact — it's re-encrypted for them before sending"
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={3}>
              <div className="rounded-xl bg-[var(--color-surface-raised,rgba(0,0,0,0.03))] px-3 py-2 ring-1 ring-black/[0.05]">
                <Text type="supporting" color="secondary">
                  Forwarding
                </Text>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-200">
                  {messagePreview}
                </p>
              </div>

              {conversations.length === 0 ? (
                <Text type="supporting" color="secondary">
                  No contacts yet. Start a chat first, then forward to it.
                </Text>
              ) : (
                <List>
                  {conversations.map((c) => (
                    <ListItem
                      key={c.peerId}
                      label={peerName(c)}
                      startContent={
                        <Avatar src={resolveAvatarUrl(c.peerAvatarUrl)} name={peerName(c)} size="small" />
                      }
                      isDisabled={forwardingTo !== null}
                      onClick={() => void handlePick(c.peerId)}
                    />
                  ))}
                </List>
              )}
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
