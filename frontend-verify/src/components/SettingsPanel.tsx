// VibeNet — Settings panel.
//
// Rendered inside the dashboard's main content area (see DashboardShell), Discord /
// Telegram style, rather than on a route of its own: clicking "Settings" in the app
// sidebar swaps this in beside it, so the chat shell — socket, conversation registry,
// derived E2EE keys — is never torn down.
//
// Internally it's the Astryx settings-sidebar layout: its own left nav selects one of
// three sections — My Profile, Privacy & Security, Appearance — rendered in the pane
// to its right. That makes two nested rails on desktop (app nav, then settings nav),
// which is exactly the Discord arrangement. On narrow viewports the inner rail
// collapses to a master→detail drill-down with a back button.
//
// The section is controlled by the parent so the sidebar's "Chat PIN" shortcut can
// open straight onto Privacy & Security.
//
// Section panels are frosted-glass cards floating on the app's ambient brand glow.
// Every surface reads its colors from the tokens in globals.css, so the whole panel
// repaints when the Appearance tab switches scheme (see .vibe-settings there).

'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import {
  ArrowLeft,
  AtSign,
  Camera,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  LogOut,
  Mail,
  Moon,
  Palette,
  Phone,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  User,
  UserMinus,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { gooeyToast } from 'goey-toast';
import { ApiError, resolveAvatarUrl, type AuthUser } from '@/lib/api';
import {
  deactivateAccount,
  deleteAccount,
  fetchMyPin,
  updateProfile,
  updatePinSettings,
  uploadAvatar,
  type PinStatus,
} from '@/lib/user';
import { clearSession } from '@/lib/session';
import { DangerZoneConfirmDialog } from '@/components/DangerZoneConfirmDialog';
import { PinInput } from '@/components/PinInput';

// Mirrors validateUsername in the backend's internal/api/handler.go, so the
// obvious mistakes are caught inline instead of via a 400. Mixed case is
// allowed; the backend enforces uniqueness case-insensitively, so "taken" is
// still reported from the server (a 409) rather than guessed at here.
const USERNAME_PATTERN = /^[A-Za-z0-9._]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 48;
// Mirrors validateDisplayName in the backend — a free-form human name, only
// bounded by the column width. Empty is allowed and defaults to the username.
const DISPLAY_NAME_MAX = 64;
// Mirrors maxAvatarBytes on the backend (5 MiB) so we reject an oversized file
// before spending a round trip on it.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// The three sections, in nav order.
const NAV_ITEMS = [
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'security', label: 'Privacy & Security', icon: ShieldCheck },
  { id: 'appearance', label: 'Appearance', icon: Palette },
] as const;

/** Which settings section is showing. The dashboard owns this so its sidebar can
 *  deep-link — "Chat PIN" opens straight onto Privacy & Security. */
export type SettingsSection = (typeof NAV_ITEMS)[number]['id'];

function usernameError(username: string): string | null {
  if (username.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (username.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(username)) {
    return 'Letters, numbers, dots, and underscores only.';
  }
  return null;
}

function displayNameError(displayName: string): string | null {
  if (displayName.length > DISPLAY_NAME_MAX) return `At most ${DISPLAY_NAME_MAX} characters.`;
  return null;
}

// SettingsCard is the frosted-glass surface every section is built from: translucent
// fill, hairline border, and a blur that lets the ambient brand glow through. Crisp
// white in light mode (not the old off-white wash), deep slate in dark.
const GLASS =
  'rounded-2xl border backdrop-blur-xl transition-colors duration-300 ease-in-out ' +
  'border-gray-200 bg-white/80 shadow-xl shadow-gray-900/5 ' +
  'dark:border-gray-800 dark:bg-gray-900/60 dark:shadow-black/30';

// The settings nav rail. A solid, distinct surface one step deeper than the content
// beside it — that contrast is what gives the split its depth.
//
// It follows the theme rather than staying dark in both: a permanently gray-950 rail
// would reintroduce exactly the light/dark seam we just removed from the app, and would
// fight the crisp light palette. gray-50 against the white content area reads as the
// same Discord-style depth step, just in the right key.
const RAIL =
  'border-r transition-colors duration-300 ease-in-out ' +
  'border-gray-200 bg-gray-50 ' +
  'dark:border-gray-800 dark:bg-gray-950';

function SettingsCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`${GLASS} p-6 sm:p-8 ${className}`}>{children}</div>;
}

// AvatarUploader renders the large circular avatar with a hover/focus overlay that
// reveals a camera icon, and a hidden file input behind it. Picking a file hands it
// back to the parent (which shows an immediate local preview and defers the upload
// until Save). The whole control is a <label> so clicking or keyboard-activating it
// opens the native file picker.
function AvatarUploader({
  src,
  name,
  onSelect,
  disabled,
}: {
  src?: string;
  name: string;
  onSelect: (file: File) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <label
      className={
        'group relative inline-flex cursor-pointer rounded-full outline-none ' +
        'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 ' +
        'focus-within:ring-offset-white dark:focus-within:ring-offset-gray-900 ' +
        (disabled ? 'pointer-events-none opacity-70' : '')
      }
      aria-label="Change profile picture"
    >
      {/* Thick border in the CONTENT surface's colour (see <main>), so the avatar reads
          as punched out of the banner it overlaps rather than pasted on top of it. */}
      <span className="relative block rounded-full border-4 border-white bg-white transition-colors duration-300 dark:border-gray-900 dark:bg-gray-900">
        <Avatar src={src} name={name} size={128} alt={name} />
        {/* Dark overlay + camera icon, revealed on hover or keyboard focus. */}
        <span
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-hidden
        >
          <Camera className="h-7 w-7" strokeWidth={1.75} />
          <span className="text-xs font-medium">Change</span>
        </span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same file still fires onChange.
          e.target.value = '';
          if (file) onSelect(file);
        }}
      />
    </label>
  );
}

// Field is the premium text input used across the profile form: a leading lucide icon
// inside the control, a generous hit area, and a glowing focus ring.
//
// It replaces Astryx's TextInput here because that component has no slot for an
// embedded icon. Everything TextInput was giving us is reproduced deliberately — the
// label is bound via htmlFor/id, the error is announced with role="alert" and wired to
// the input through aria-describedby + aria-invalid, and `readOnly` (not `disabled`)
// keeps the sign-up values focusable and screen-reader-visible.
function Field({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  description,
  error,
  readOnly = false,
  placeholder,
  name,
  required = false,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string;
  onChange?: (value: string) => void;
  description?: string;
  error?: string | null;
  readOnly?: boolean;
  placeholder?: string;
  name?: string;
  required?: boolean;
}) {
  const describedBy = error ? `${id}-error` : description ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>

      <div className="relative">
        <Icon
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400 dark:text-gray-500"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          id={id}
          name={name}
          type="text"
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange?.(e.target.value)}
          className={[
            'w-full rounded-xl border py-3.5 pl-11 pr-4 text-sm outline-none',
            'transition-colors duration-200 ease-in-out',
            'bg-white text-gray-900 placeholder:text-gray-400',
            'dark:bg-gray-900/60 dark:text-white dark:placeholder:text-gray-500',
            'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50',
            readOnly ? 'cursor-not-allowed text-gray-500 dark:text-gray-400' : '',
            error
              ? 'border-red-400 dark:border-red-500'
              : 'border-gray-200 dark:border-gray-800',
          ].join(' ')}
        />
      </div>

      {error ? (
        <span id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : description ? (
        <span id={`${id}-hint`} className="text-xs text-gray-500 dark:text-gray-400">
          {description}
        </span>
      ) : null}
    </div>
  );
}

// ProfilePanel — the avatar (centered, hover-to-change) above the account fields.
// Saving uploads a newly-picked image first, then persists the name/username edits.
function ProfilePanel({
  user,
  onUpdated,
}: {
  user: AuthUser;
  onUpdated: (user: AuthUser) => void;
}) {
  // Existing accounts created before display_name existed may arrive without one;
  // seed the field from the username so it's never blank in the editor.
  const currentDisplayName = user.display_name || user.username;
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [saving, setSaving] = useState(false);

  // A locally-picked avatar plus its object-URL preview, shown immediately and
  // only uploaded on Save. previewUrl is revoked when it changes or on unmount.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const trimmedUsername = username.trim();
  const trimmedDisplayName = displayName.trim();

  // Only nag once they've actually changed a field to something invalid.
  const usernameErr = trimmedUsername === user.username ? null : usernameError(trimmedUsername);
  const displayNameErr = displayNameError(trimmedDisplayName);
  const usernameChanged = trimmedUsername !== user.username;
  const displayNameChanged = trimmedDisplayName !== currentDisplayName;
  const avatarChanged = avatarFile !== null;
  const textValid = usernameErr === null && displayNameErr === null;
  const canSave = (usernameChanged || displayNameChanged || avatarChanged) && textValid;

  function handleSelectAvatar(file: File) {
    if (!file.type.startsWith('image/')) {
      gooeyToast.warning('Please choose an image file.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      gooeyToast.warning('That image is over 5 MB — please pick a smaller one.');
      return;
    }
    setAvatarFile(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    try {
      let updated: AuthUser = user;
      // 1. Upload the picture first (if changed) so the profile write below reads
      //    back the fresh avatar_url too.
      if (avatarFile) {
        updated = await uploadAvatar(avatarFile);
      }
      // 2. Persist name/username edits. A blank real name defaults to the username
      //    (matches the backend). Returns the full profile, including the new avatar.
      if (usernameChanged || displayNameChanged) {
        updated = await updateProfile(trimmedUsername, trimmedDisplayName || trimmedUsername);
      }
      onUpdated(updated);
      // Clear the pending picture now it's saved; the avatar renders from the
      // updated user prop from here on.
      setAvatarFile(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      gooeyToast.success('Profile updated.');
    } catch (err) {
      gooeyToast.error(
        err instanceof ApiError ? err.message : 'Could not update your profile.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Full-bleed banner. Purely decorative, so it's hidden from the a11y tree. */}
      <div
        aria-hidden
        className="h-64 w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600"
      />

      <div className="px-6 pb-12 sm:px-8">
        {/* Avatar rides up over the banner's bottom edge; Save sits opposite it. The row
            stacks on narrow screens so the button never crowds the name. */}
        <div className="-mt-16 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <AvatarUploader
              src={previewUrl ?? resolveAvatarUrl(user.avatar_url)}
              name={currentDisplayName}
              onSelect={handleSelectAvatar}
              disabled={saving}
            />
            <div className="pb-1">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {currentDisplayName}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">@{user.username}</p>
            </div>
          </div>

          <div className="vibe-cta pb-1">
            <Button
              label={saving ? 'Saving…' : 'Save Changes'}
              type="submit"
              variant="primary"
              size="lg"
              isLoading={saving}
              isDisabled={!canSave}
            />
          </div>
        </div>

        {/* Upload hint — doubles as the "unsaved photo" cue. */}
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {avatarChanged
            ? 'New photo ready — click Save Changes to apply it.'
            : 'Click your avatar to upload a new photo. PNG, JPG, WebP, or GIF up to 5 MB.'}
        </p>

        <div className="mt-10">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Account details</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            How your account presents itself across VibeNet.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field
              id="display_name"
              name="display_name"
              label="Real Name (Display Name)"
              icon={User}
              description="What people see across VibeNet."
              value={displayName}
              onChange={setDisplayName}
              error={displayNameErr}
            />
            <Field
              id="username"
              name="username"
              label="Username"
              icon={AtSign}
              description="Your unique handle in search."
              value={username}
              onChange={setUsername}
              error={usernameErr}
              required
            />
            <Field
              id="email"
              label="Email"
              icon={Mail}
              value={user.email ?? ''}
              placeholder="Not set"
              description="Set when you registered and can't be changed here."
              readOnly
            />
            <Field
              id="phone"
              label="Phone Number"
              icon={Phone}
              value={user.phone_number ?? ''}
              placeholder="Not set"
              description="Set when you registered and can't be changed here."
              readOnly
            />
          </div>
        </div>
      </div>
    </form>
  );
}

// mmss formats a whole number of seconds as "M:SS" for the rotating-PIN countdown.
function mmss(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

// SecurityPanel configures the anti-spam chat PIN: a master toggle, a rotating vs.
// static choice, and — for static — a 6-digit custom PIN. It also shows the code the
// owner should share right now (with a live countdown for the rotating code).
function SecurityPanel({
  user,
  onUpdated,
}: {
  user: AuthUser;
  onUpdated: (user: AuthUser) => void;
}) {
  const wasEnabled = user.chat_pin_enabled ?? true;
  const wasType = user.chat_pin_type ?? 'rotating';

  const [enabled, setEnabled] = useState(wasEnabled);
  const [type, setType] = useState<'rotating' | 'static'>(wasType);
  const [customPin, setCustomPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<PinStatus | null>(null);
  // Wall clock, advanced once a second while a rotating code is on screen. The
  // countdown is derived from it during render rather than stored, so there's no
  // second copy of the same truth to drift.
  const [now, setNow] = useState(() => Date.now());

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchMyPin());
    } catch {
      // Non-fatal: the settings still work without the live code preview.
    }
  }, []);

  // loadStatus only reaches setStatus after awaiting the network, so it can't cascade
  // renders the way the set-state-in-effect rule guards against — the rule just can't
  // see through the async boundary. Same reasoning for the refetch effect below.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState is post-await
    void loadStatus();
  }, [loadStatus]);

  const expiry = status?.expires_at ? new Date(status.expires_at).getTime() : 0;
  const remaining = expiry ? Math.max(0, Math.round((expiry - now) / 1000)) : 0;

  // Tick only while a rotating code with an expiry is on screen.
  useEffect(() => {
    if (!expiry) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiry]);

  // Once the code lapses, pull the fresh one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState is post-await
    if (expiry && remaining <= 0) void loadStatus();
  }, [expiry, remaining, loadStatus]);

  // Switching *into* static requires a fresh 6-digit PIN; staying on static lets you
  // keep the existing one (leave the field blank) or replace it (enter a new one).
  const wasStatic = wasType === 'static';
  const settingsChanged = enabled !== wasEnabled || type !== wasType;
  const customPinValid = customPin.length === 6;
  let canSave = false;
  if (!enabled) canSave = settingsChanged;
  else if (type === 'rotating') canSave = settingsChanged;
  else canSave = wasStatic ? settingsChanged || customPinValid : customPinValid;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const next = await updatePinSettings({
        enabled,
        type,
        customPin: type === 'static' && customPinValid ? customPin : undefined,
      });
      setStatus(next);
      setCustomPin('');
      onUpdated({ ...user, chat_pin_enabled: next.enabled, chat_pin_type: next.type });
      gooeyToast.success('Security settings saved.');
    } catch (err) {
      gooeyToast.error(err instanceof ApiError ? err.message : 'Could not save your PIN settings.');
    } finally {
      setSaving(false);
    }
  }

  async function copyPin() {
    if (!status?.pin) return;
    try {
      await navigator.clipboard.writeText(status.pin);
      gooeyToast.success('PIN copied to clipboard.');
    } catch {
      gooeyToast.error('Could not copy — your browser blocked clipboard access.');
    }
  }

  // 5-minute window, drained as a slim progress bar rather than plain "M:SS" text.
  const ROTATING_WINDOW_SECONDS = 300;
  const progressPct = expiry
    ? Math.max(0, Math.min(100, (remaining / ROTATING_WINDOW_SECONDS) * 100))
    : 0;

  return (
    <VStack gap={8}>
      {/* Master toggle — a soft, borderless tint that now spans the full row width,
          with the switch pinned to the far right (labelSpacing="spread") instead of
          hugging the label like a narrow, cramped control. */}
      <div className="flex w-full items-center gap-4 rounded-2xl bg-gray-50/80 p-5 transition-colors duration-300 ease-in-out hover:bg-gray-100/80 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[color:var(--vibe-blue)]/25 to-[color:var(--vibe-blue)]/5 text-[color:var(--vibe-blue)]">
          <ShieldCheckIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <Switch
            label="Enable Chat PIN Verification"
            description="Strangers must enter your current PIN before they can message you — your defence against spam."
            value={enabled}
            onChange={setEnabled}
            width="100%"
            labelSpacing="spread"
          />
        </div>
      </div>

      {/* Configuration — only meaningful while enabled, separated by a hairline
          rather than a second boxed card. */}
      {enabled && (
        <VStack gap={5}>
          <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent dark:via-gray-800" />

          <VStack gap={1}>
            <Heading level={2}>PIN mode</Heading>
            <Text type="supporting" color="secondary">
              Choose how your PIN is generated.
            </Text>
          </VStack>

          {/* Wrapped in the same soft tint as the master toggle row, so the two
              controls read as one consistent design language — and stretched to
              fill the full row (layout="fill") instead of a small hugging pill. */}
          <div className="w-full rounded-2xl bg-gray-50/80 p-2 transition-colors duration-300 ease-in-out dark:bg-white/[0.03]">
            <SegmentedControl
              value={type}
              onChange={(v) => setType(v as 'rotating' | 'static')}
              label="PIN mode"
              layout="fill"
              size="lg"
            >
              <SegmentedControlItem value="rotating" label="5-Minute Rotating PIN" />
              <SegmentedControlItem value="static" label="Custom Static PIN" />
            </SegmentedControl>
          </div>

          {type === 'rotating' ? (
            // Glowing, borderless code display: a soft brand-gradient wash with two
            // blurred glow blobs behind it, rather than a flat bordered box.
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[color:var(--vibe-blue)]/[0.07] via-transparent to-[color:var(--vibe-green)]/[0.05] p-8 text-center transition-colors duration-300 ease-in-out">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[color:var(--vibe-blue)]/20 blur-3xl"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-16 right-1/4 h-40 w-40 rounded-full bg-[color:var(--vibe-green)]/15 blur-3xl"
              />

              <div className="relative">
                <Text type="supporting" color="secondary">
                  Your current code — it changes every 5 minutes.
                </Text>

                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="font-mono text-4xl font-bold tracking-[0.32em] text-gray-900 dark:text-white">
                    {status?.pin ?? '••••••'}
                  </span>
                  {status?.pin && (
                    <button
                      type="button"
                      onClick={() => void copyPin()}
                      aria-label="Copy PIN"
                      title="Copy PIN"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 outline-none transition-colors duration-200 hover:bg-black/5 hover:text-[color:var(--vibe-blue)] focus-visible:ring-2 focus-visible:ring-[color:var(--vibe-blue)] dark:text-gray-500 dark:hover:bg-white/10"
                    >
                      <Copy className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                </div>

                {remaining > 0 && (
                  <div className="mx-auto mt-5 max-w-[220px]">
                    <div className="h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: 'var(--vibe-gradient)' }}
                        animate={{ width: `${progressPct}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    </div>
                    <Text type="supporting" color="secondary" className="mt-2 block">
                      Refreshes in {mmss(remaining)}
                    </Text>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <VStack gap={3}>
              <Text type="supporting" color="secondary">
                {wasStatic
                  ? 'Enter a new 6-digit PIN to change it, or leave blank to keep your current one.'
                  : 'Set a 6-digit PIN you can share with people you want to reach you.'}
              </Text>
              <PinInput
                value={customPin}
                onChange={setCustomPin}
                masked
                length={6}
                ariaLabel="Custom PIN"
              />
            </VStack>
          )}
        </VStack>
      )}

      <div className="flex justify-end">
        <div className="vibe-cta">
          <Button
            label={saving ? 'Saving…' : 'Save Security Settings'}
            variant="primary"
            size="lg"
            isLoading={saving}
            isDisabled={!canSave}
            onClick={() => void handleSave()}
          />
        </div>
      </div>

      <DangerZone user={user} />
    </VStack>
  );
}

// DangerZone — irreversible-account-action row pair at the bottom of Privacy &
// Security. Deactivate is reversible (an operator can flip status back) and only
// needs a plain yes/no gate, so it uses Astryx's AlertDialog directly. Delete is
// permanent, so it additionally requires typing "DELETE" or the account's own
// username — a confirmation AlertDialog has no slot for, hence the custom
// DangerZoneConfirmDialog (built from the same Dialog/Layout primitives AlertDialog
// itself is composed from).
//
// Both actions end the session client-side on success: clear the stored JWT/keys
// and send the person to /login, matching what a deactivated/deleted account can
// no longer do (log back in) here on this device too.
function DangerZone({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<'deactivate' | 'delete' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function runAction(
    action: () => Promise<{ message: string }>,
    successMessage: string,
    failureMessage: string,
  ) {
    setSubmitting(true);
    try {
      await action();
      clearSession();
      gooeyToast.success(successMessage);
      router.replace('/login');
    } catch (err) {
      gooeyToast.error(err instanceof ApiError ? err.message : failureMessage);
      setSubmitting(false);
      setConfirming(null);
    }
  }

  return (
    <VStack gap={5}>
      <div className="h-px bg-gradient-to-r from-transparent via-red-200 to-transparent dark:via-red-900/40" />

      <VStack gap={1}>
        <Heading level={2}>Danger Zone</Heading>
        <Text type="supporting" color="secondary">
          These actions affect your whole account. Proceed with caution.
        </Text>
      </VStack>

      <div className="flex w-full flex-col gap-4 rounded-2xl bg-amber-50/80 p-5 transition-colors duration-300 ease-in-out dark:bg-amber-500/[0.06] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <UserMinus className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Deactivate Account</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Sign out everywhere and hide your account from new logins. Your profile and
              messages stay visible to others, marked as deactivated — you can come back later.
            </p>
          </div>
        </div>
        <div className="vibe-cta-warning shrink-0">
          <Button
            label="Deactivate Account"
            variant="secondary"
            onClick={() => setConfirming('deactivate')}
          />
        </div>
      </div>

      <div className="flex w-full flex-col gap-4 rounded-2xl bg-red-50/80 p-5 transition-colors duration-300 ease-in-out dark:bg-red-500/[0.06] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400">
            <Trash2 className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Delete Account</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Permanently erase your real name, email, phone number, and photo. This can&apos;t
              be undone. Messages you&apos;ve already sent stay in your conversations, shown as
              sent by a deleted user.
            </p>
          </div>
        </div>
        <Button
          label="Delete Account"
          variant="destructive"
          className="shrink-0"
          onClick={() => setConfirming('delete')}
        />
      </div>

      <AlertDialog
        isOpen={confirming === 'deactivate'}
        onOpenChange={(open) => !open && !submitting && setConfirming(null)}
        title="Deactivate your account?"
        description="You'll be signed out on every device and won't be able to log back in until you reactivate. Your profile and past messages stay visible to others in the meantime."
        actionLabel={submitting ? 'Deactivating…' : 'Deactivate'}
        actionVariant="destructive"
        isActionLoading={submitting}
        onAction={() =>
          void runAction(
            deactivateAccount,
            'Your account has been deactivated.',
            'Could not deactivate your account.',
          )
        }
      />

      <DangerZoneConfirmDialog
        isOpen={confirming === 'delete'}
        onOpenChange={(open) => !open && !submitting && setConfirming(null)}
        title="Delete your account?"
        description="This permanently erases your real name, email, phone number, and photo, and cannot be undone. Messages you've already sent stay in your conversations, shown as sent by a deleted user."
        actionLabel={submitting ? 'Deleting…' : 'Delete Account'}
        confirmWord="DELETE"
        username={user.username}
        isActionLoading={submitting}
        onAction={() =>
          void runAction(
            deleteAccount,
            'Your account has been deleted.',
            'Could not delete your account.',
          )
        }
      />
    </VStack>
  );
}

// ThemeCard — one of the two illustrated scheme choices. The artwork is built from
// absolutely-positioned lucide glyphs over a gradient rather than an image, so it
// scales cleanly and costs no network round-trip. Motion is kept to a lift on hover
// and a spring on the check; the illustration itself doesn't animate, which would
// pull attention away from the form beside it.
//
// `isActive` is the *committed* choice; `isResolved` marks the card the OS is
// currently resolving to while "Match system" is on, so the preview still shows what
// you're looking at without claiming you picked it.
function ThemeCard({
  scheme,
  isActive,
  isResolved,
  onSelect,
}: {
  scheme: 'light' | 'dark';
  isActive: boolean;
  isResolved: boolean;
  onSelect: () => void;
}) {
  const isDark = scheme === 'dark';
  const label = isDark ? 'Dark' : 'Light';

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      aria-label={`${label} theme`}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={[
        'group relative block w-full overflow-hidden rounded-3xl text-left',
        'border transition-shadow duration-300 outline-none',
        'focus-visible:ring-2 focus-visible:ring-blue-500',
        isActive
          ? 'border-blue-500/60 ring-2 ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]'
          : isResolved
            ? 'border-blue-500/30 ring-1 ring-blue-500/30'
            : 'border-white/10 hover:border-white/25',
      ].join(' ')}
    >
      {/* Illustration */}
      <div
        className={[
          'relative h-40 w-full overflow-hidden',
          isDark
            ? 'bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#0b1220]'
            : 'bg-gradient-to-br from-sky-300 via-sky-200 to-amber-100',
        ].join(' ')}
      >
        {isDark ? (
          <>
            <Moon
              className="absolute right-6 top-5 h-10 w-10 text-indigo-100 drop-shadow-[0_0_10px_rgba(199,210,254,0.55)]"
              strokeWidth={1.5}
            />
            <Star className="absolute left-6 top-6 h-3 w-3 fill-current text-indigo-200/90" strokeWidth={0} />
            <Star className="absolute left-16 top-12 h-2 w-2 fill-current text-indigo-200/70" strokeWidth={0} />
            <Star className="absolute left-28 top-5 h-2.5 w-2.5 fill-current text-indigo-200/80" strokeWidth={0} />
            <Star className="absolute right-24 top-14 h-2 w-2 fill-current text-indigo-200/60" strokeWidth={0} />
            <Cloud
              className="absolute bottom-5 left-5 h-12 w-12 fill-indigo-400/15 text-indigo-300/35"
              strokeWidth={1.25}
            />
            <Cloud
              className="absolute bottom-8 right-8 h-9 w-9 text-indigo-300/25"
              strokeWidth={1.25}
            />
          </>
        ) : (
          <>
            <Sun
              className="absolute right-6 top-5 h-11 w-11 text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.6)]"
              strokeWidth={1.5}
            />
            <Cloud
              className="absolute bottom-6 left-5 h-12 w-12 fill-white text-white drop-shadow-sm"
              strokeWidth={1.25}
            />
            <Cloud
              className="absolute bottom-10 right-10 h-8 w-8 fill-white/90 text-white/90"
              strokeWidth={1.25}
            />
            <Cloud
              className="absolute left-24 top-8 h-7 w-7 fill-white/70 text-white/70"
              strokeWidth={1.25}
            />
          </>
        )}

        {/* Selected check — springs in rather than popping. */}
        <AnimatePresence>
          {isActive && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              className="absolute left-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg shadow-blue-500/40"
            >
              <Check className="h-4 w-4" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Caption */}
      <div className="flex items-center justify-between gap-2 bg-gray-50 px-4 py-3 transition-colors duration-300 ease-in-out dark:bg-gray-900/70">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</span>
        {isActive ? (
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Selected</span>
        ) : isResolved ? (
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Current</span>
        ) : null}
      </div>
    </motion.button>
  );
}

// AppearancePanel drives next-themes, which writes the .dark class onto <html> — that
// one class flips both the Tailwind `dark:` variants and (via color-scheme) every
// Astryx component in the app. See components/ThemeProvider.tsx.
//
// The two cards cover the explicit choices; "Match system" is kept as a separate switch
// rather than a third card, because it isn't a look you can illustrate — it's a rule
// about which of the other two applies. Turning it on leaves the resolved card marked
// "Current"; picking a card turns it back off.
function AppearancePanel() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  // next-themes can't know the active theme until it has read the DOM on the client, so
  // `theme` is undefined on the server and during the first render. Rendering the
  // selection state before then would mark the wrong card and mismatch on hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration flag
    setMounted(true);
  }, []);

  const followsSystem = theme === 'system';
  const resolved = resolvedTheme === 'dark' ? 'dark' : 'light';

  return (
    <SettingsCard>
      <VStack gap={5}>
        <VStack gap={1}>
          <Heading level={2}>Theme</Heading>
          <Text type="supporting" color="secondary">
            Pick how VibeNet looks, or follow your device.
          </Text>
        </VStack>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(['light', 'dark'] as const).map((option) => (
            <ThemeCard
              key={option}
              scheme={option}
              isActive={mounted && !followsSystem && theme === option}
              isResolved={mounted && followsSystem && resolved === option}
              onSelect={() => setTheme(option)}
            />
          ))}
        </div>

        <Switch
          label="Match my system setting"
          description="Follows your device's light/dark preference automatically."
          value={mounted && followsSystem}
          onChange={(on) => setTheme(on ? 'system' : resolved)}
        />
      </VStack>
    </SettingsCard>
  );
}

export function SettingsPanel({
  user,
  section,
  onSectionChange,
  onUserUpdated,
  onLogout,
}: {
  user: AuthUser | null;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}) {
  const isNarrow = useMediaQuery('(max-width: 768px)');

  // Mobile is a master→detail drill-down: 'nav' shows the menu, 'detail' shows the
  // selected section behind a back button. Desktop shows both side-by-side.
  // Opening settings from the app sidebar lands on the menu; picking a section (or
  // arriving via the "Chat PIN" shortcut) drills in.
  const [mobileView, setMobileView] = useState<'nav' | 'detail'>('nav');

  // Selecting a nav item also drills into the detail view on mobile.
  const selectSection = (id: SettingsSection) => {
    onSectionChange(id);
    setMobileView('detail');
  };

  const activeItem = NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0];

  // The nav rail. Deliberately NOT Astryx's List — plain buttons let the rail own its
  // own selected/hover treatment (a tinted pill) rather than the design system's.
  const nav = (
    <nav className="flex h-full min-h-0 flex-1 flex-col gap-1 p-3" aria-label="Settings sections">
      <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Settings
      </h2>

      {NAV_ITEMS.map((item) => {
        const isSelected = section === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => selectSection(item.id)}
            aria-current={isSelected ? 'page' : undefined}
            className={[
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium',
              'outline-none transition-colors duration-200 ease-in-out',
              'focus-visible:ring-2 focus-visible:ring-blue-500',
              isSelected
                ? 'bg-gray-200/80 text-gray-900 dark:bg-gray-800/80 dark:text-white'
                : 'text-gray-600 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/40 dark:hover:text-gray-100',
            ].join(' ')}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
            <span className="flex-1 truncate">{item.label}</span>
            {isNarrow && <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />}
          </button>
        );
      })}

      {/* Log Out sits at the very bottom, quiet until reached for — then red. */}
      <div className="mt-auto pt-3">
        <div className="mb-2 h-px bg-gray-200 dark:bg-gray-800" />
        <button
          type="button"
          onClick={onLogout}
          className={[
            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium',
            'text-gray-600 outline-none transition-colors duration-200 ease-in-out dark:text-gray-400',
            'hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400',
            'focus-visible:ring-2 focus-visible:ring-red-500',
          ].join(' ')}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          <span>Log Out</span>
        </button>
      </div>
    </nav>
  );

  // The mobile back-link and (for the non-profile sections) the page title. Profile
  // opts out of the title: its banner + name already announce the section, and a
  // heading above a full-bleed banner would just push it off the top.
  const isProfile = section === 'profile';

  const backLink = isNarrow && (
    <button
      type="button"
      onClick={() => setMobileView('nav')}
      className="-ml-1 flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-gray-600 outline-none transition-colors duration-200 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:text-gray-100"
    >
      <ArrowLeft className="h-4 w-4" />
      Settings
    </button>
  );

  const content = (
    <>
      {/* Profile is full-bleed (the banner runs edge to edge); the other sections get
          the usual page padding and a readable measure. */}
      {isProfile && backLink && <div className="px-6 pt-4 sm:px-8">{backLink}</div>}

      {user && isProfile && (
        <ProfilePanel
          key={`${user.username}:${user.display_name}`}
          user={user}
          onUpdated={onUserUpdated}
        />
      )}

      {!isProfile && (
        // Full width rather than a capped reading measure: these sections are
        // controls and cards, not prose, so they should use the space the split
        // layout actually gives them instead of leaving the pane half-empty.
        <div className="w-full px-6 py-8 sm:px-8">
          <VStack gap={6}>
            {backLink}
            <Heading level={1} type={isNarrow ? undefined : 'display-3'}>
              {activeItem.label}
            </Heading>

            {/* Panels are keyed on the persisted values they seed from, so they reseed
                after a save — or after useAuth's background refresh reports a change
                from another device — instead of holding stale local state. */}
            {user && section === 'security' && (
              <SecurityPanel
                key={`${user.chat_pin_enabled}:${user.chat_pin_type}`}
                user={user}
                onUpdated={onUserUpdated}
              />
            )}

            {section === 'appearance' && <AppearancePanel />}
          </VStack>
        </div>
      )}
    </>
  );

  // Mobile, nav view: the rail owns the pane (no split).
  if (isNarrow && mobileView === 'nav') {
    return (
      <div className={`vibe-settings h-full w-full ${RAIL}`}>{nav}</div>
    );
  }

  // Desktop: an edge-to-edge split filling the dashboard's content area — a fixed nav
  // rail welded to the left, then the section itself. No outer padding or rounding: the
  // panel is now the whole surface, which is what lets the profile banner run full
  // bleed to the top and right edges.
  return (
    <div className="vibe-settings flex h-full w-full">
      {/* Full height, so Log Out pins to the bottom of the rail. */}
      {!isNarrow && (
        <aside className={`${RAIL} flex h-full w-80 shrink-0 flex-col overflow-x-hidden overflow-y-auto`}>
          {nav}
        </aside>
      )}

      {/* One step lighter than the rail in both themes, so the split keeps its depth in
          dark instead of both halves collapsing to the same slate. */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-white transition-colors duration-300 ease-in-out dark:bg-gray-900">
        {content}
      </main>
    </div>
  );
}
