// VibeNet — chat-unlock PIN verification dialog.
//
// The chat PIN is single-sided: before a chat room opens, the CURRENT user enters
// THEIR OWN 6-digit PIN to unlock the chat interface. This ultra-modern centered
// overlay shows the current user's avatar and six segmented boxes; the parent
// verifies the code server-side (POST /api/user/verify-pin) and, on failure, feeds
// back an `error` which triggers a shake + clears the boxes. On success the parent
// closes the dialog and opens the chat.

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { LockClosedIcon } from '@heroicons/react/24/solid';
import { resolveAvatarUrl } from '@/lib/api';
import { PinInput } from './PinInput';

const PIN_LENGTH = 6;

export function PinPromptDialog({
  isOpen,
  title = 'Enter your chat PIN',
  avatarName,
  avatarUrl,
  subtitle,
  isVerifying,
  error,
  errorNonce = 0,
  onSubmit,
  onCancel,
}: {
  isOpen: boolean;
  /** Dialog heading. Defaults to the self-unlock wording; pass a target-specific
   *  title (e.g. "Enter Alex's chat PIN") when verifying a recipient's PIN. */
  title?: string;
  /** The name whose avatar/initials the dialog shows — the current user for a
   *  self-unlock, or the target recipient when gating on their PIN. */
  avatarName: string;
  avatarUrl?: string;
  /** Context line under the title, e.g. which chat is being opened. */
  subtitle?: ReactNode;
  isVerifying: boolean;
  error?: string | null;
  /** Bump this on each failed attempt to re-trigger the shake, even if `error` text is unchanged. */
  errorNonce?: number;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  const controls = useAnimationControls();

  // Reset the field whenever the dialog (re)opens.
  useEffect(() => {
    if (isOpen) setPin('');
  }, [isOpen]);

  // On a verification failure, shake the panel and clear the boxes so the person
  // can retype. Keyed on errorNonce so repeated identical errors still re-trigger.
  useEffect(() => {
    if (errorNonce <= 0) return;
    setPin('');
    void controls.start({
      x: [0, -10, 10, -8, 8, -4, 4, 0],
      transition: { duration: 0.45 },
    });
  }, [errorNonce, controls]);

  function submit(code: string) {
    if (code.length === PIN_LENGTH && !isVerifying) onSubmit(code);
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}>
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0 h-full w-full cursor-default bg-slate-900/50 backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/60 dark:border-gray-700/60 bg-white/80 dark:bg-gray-900/80 p-7 shadow-2xl shadow-slate-900/20 backdrop-blur-xl"
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
            <motion.div animate={controls} className="flex flex-col items-center gap-4 text-center">
              <div className="relative">
                <span
                  aria-hidden
                  className="absolute -inset-1.5 rounded-full opacity-70 blur-md"
                  style={{ background: 'var(--vibe-gradient)' }}
                />
                <span className="relative block rounded-full ring-4 ring-white/80 dark:ring-gray-800/80">
                  <Avatar src={resolveAvatarUrl(avatarUrl)} name={avatarName} size={72} alt={avatarName} />
                </span>
                <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--vibe-blue)] text-white ring-2 ring-white">
                  <LockClosedIcon className="h-4 w-4" />
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400">
                  {subtitle ?? 'Enter your 6-digit chat PIN to unlock your conversations.'}
                </p>
              </div>

              <div className="w-full pt-1">
                <PinInput
                  value={pin}
                  onChange={setPin}
                  onComplete={submit}
                  length={PIN_LENGTH}
                  autoFocus
                  disabled={isVerifying}
                  hasError={Boolean(error)}
                  ariaLabel="Chat PIN"
                />
                <div className="min-h-[1.25rem] pt-2">
                  {error && <p className="text-sm font-medium text-red-600">{error}</p>}
                </div>
              </div>

              <div className="flex w-full gap-2 pt-1">
                <div className="flex-1">
                  <Button
                    label="Cancel"
                    variant="secondary"
                    size="lg"
                    onClick={onCancel}
                    className="w-full"
                  />
                </div>
                <div className="flex-1">
                  <Button
                    label={isVerifying ? 'Verifying…' : 'Unlock'}
                    variant="primary"
                    size="lg"
                    isLoading={isVerifying}
                    isDisabled={pin.length !== PIN_LENGTH}
                    onClick={() => submit(pin)}
                    className="w-full"
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
