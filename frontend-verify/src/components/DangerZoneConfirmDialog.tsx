// VibeNet — type-to-confirm dialog for irreversible account actions.
//
// Astryx's AlertDialog (see SettingsPanel's "Deactivate Account" flow) has no slot
// for embedded content, only a title/description string pair — so it can't host the
// "type DELETE or your username" confirmation the danger-zone delete flow needs.
// This reuses the same building blocks AlertDialog itself is composed from (Dialog +
// Layout + Text + Button — see @astryxdesign/core/AlertDialog's file header) so it
// stays visually and behaviourally consistent: non-dismissible by backdrop click,
// same footer button layout, same destructive styling.

'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Button, type ButtonVariant } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';

export function DangerZoneConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  actionLabel,
  actionVariant = 'destructive',
  confirmWord,
  username,
  isActionLoading,
  onAction,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  description: string;
  actionLabel: string;
  actionVariant?: ButtonVariant;
  /** The literal word (e.g. "DELETE") that unlocks the action button, case-insensitive. */
  confirmWord: string;
  /** The account's username — accepted as an alternative to confirmWord. */
  username: string;
  isActionLoading: boolean;
  onAction: () => void;
}) {
  const [value, setValue] = useState('');

  // Reset the field whenever the dialog (re)opens, so a previous confirmation
  // can't linger and silently re-arm the button.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on (re)open
    if (isOpen) setValue('');
  }, [isOpen]);

  const normalized = value.trim().toLowerCase();
  const isConfirmed = normalized.length > 0 &&
    (normalized === confirmWord.toLowerCase() || normalized === username.toLowerCase());

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={440}>
      <Layout
        header={<DialogHeader title={title} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <Text type="body" color="secondary">
                {description}
              </Text>
              <Text type="supporting" color="secondary">
                Type <strong>{confirmWord}</strong> or your username (
                <strong>{username}</strong>) below to confirm.
              </Text>
              <TextInput
                label="Confirmation"
                isLabelHidden
                value={value}
                onChange={setValue}
                placeholder={`Type "${confirmWord}" to confirm`}
                hasAutoFocus
                onEnter={() => {
                  if (isConfirmed && !isActionLoading) onAction();
                }}
              />
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex justify-end gap-2">
              <Button
                label="Cancel"
                variant="ghost"
                isDisabled={isActionLoading}
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={actionLabel}
                variant={actionVariant}
                isLoading={isActionLoading}
                isDisabled={!isConfirmed || isActionLoading}
                onClick={onAction}
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
