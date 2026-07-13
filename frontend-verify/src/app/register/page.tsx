// VibeNet — Register (route: "/register").
//
// Because VibeNet is end-to-end encrypted, registration generates the account's
// E2EE keypair in the browser first (private key stays on the device), then
// posts { username, password, email, phone_number, public_key } to POST /api/auth/register. On
// success it stores the JWT + user and the private key, then sends the person
// home. Google sign-up is a full-page redirect to the backend.

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { gooeyToast } from 'goey-toast';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { AuthShell } from '@/components/AuthShell';
import { GoogleButton } from '@/components/GoogleButton';
import { register, ApiError } from '@/lib/api';
import { saveSession } from '@/lib/session';
import { generateKeyPair, storePrivateKey } from '@/lib/e2ee';

const MIN_PASSWORD = 8;
// Mirror of the backend's permissive checks (validateEmail / validatePhoneNumber
// in internal/api/handler.go) so obvious mistakes are caught before we generate a
// keypair and hit the network.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
// Strip human-friendly separators before validating/sending so the number matches
// the backend's normalization and the phone unique index.
const stripPhone = (value: string) => value.replace(/[\s().-]/g, '');

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Duplicate email/phone are only known once the backend responds (409); we surface
  // them inline on the offending field. Cleared as soon as that field is edited.
  const [emailError, setEmailError] = useState<string | undefined>();
  const [phoneError, setPhoneError] = useState<string | undefined>();

  // Field-level validation shown inline under the password inputs.
  const passwordStatus =
    password.length > 0 && password.length < MIN_PASSWORD
      ? ({ type: 'error', message: `At least ${MIN_PASSWORD} characters.` } as const)
      : undefined;
  const confirmStatus =
    confirm.length > 0 && confirm !== password
      ? ({ type: 'error', message: 'Passwords do not match.' } as const)
      : undefined;
  const emailStatus = emailError
    ? ({ type: 'error', message: emailError } as const)
    : undefined;
  const phoneStatus = phoneError
    ? ({ type: 'error', message: phoneError } as const)
    : undefined;

  function handleEmailChange(value: string) {
    setEmail(value);
    if (emailError) setEmailError(undefined);
  }

  function handlePhoneChange(value: string) {
    setPhoneNumber(value);
    if (phoneError) setPhoneError(undefined);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const name = username.trim();
    const trimmedEmail = email.trim();
    const normalizedPhone = stripPhone(phoneNumber);
    if (!name || !trimmedEmail || !normalizedPhone || !password || !confirm) {
      gooeyToast.warning('Fill in every field to continue.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    if (!PHONE_PATTERN.test(normalizedPhone)) {
      setPhoneError('Please enter a valid phone number.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      gooeyToast.warning(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      gooeyToast.warning('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Generate the E2EE keypair locally — the private key never leaves here.
      const keys = await generateKeyPair();
      // 2. Register with the public key.
      const result = await register({
        username: name,
        password,
        email: trimmedEmail,
        phoneNumber: normalizedPhone,
        publicKey: keys.publicKey,
      });
      // 3. Persist the private key and the new session, then continue.
      storePrivateKey(result.user.user_id, keys.privateKeyJwk);
      saveSession(result);
      gooeyToast.success('Account created — your keys are on this device.');
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Backend reports the exact collision; pin it to the matching field.
        const message = err.message.toLowerCase();
        if (message.includes('email')) {
          setEmailError(err.message);
        } else if (message.includes('phone')) {
          setPhoneError(err.message);
        }
      }
      gooeyToast.error(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your encryption keys are generated on this device and never leave it."
      footer={
        <Text type="supporting" color="secondary">
          Already have an account?{' '}
          <Link href="/login" className="vibe-link">
            Log in
          </Link>
        </Text>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <TextInput
          type="text"
          label="Username"
          placeholder="pick-a-username"
          value={username}
          onChange={setUsername}
          htmlName="username"
          size="lg"
          isRequired
        />

        <TextInput
          type="email"
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChange={handleEmailChange}
          htmlName="email"
          size="lg"
          isRequired
          status={emailStatus}
        />

        {/* The design-system TextInput's `type` union is text|password|email, so we
            use "text" here; digits/format are enforced by PHONE_PATTERN on submit. */}
        <TextInput
          type="text"
          label="Phone number"
          placeholder="+1 555 010 1234"
          value={phoneNumber}
          onChange={handlePhoneChange}
          htmlName="phoneNumber"
          size="lg"
          isRequired
          status={phoneStatus}
        />

        <TextInput
          type="password"
          label="Password"
          description="Use at least 8 characters."
          placeholder="••••••••"
          value={password}
          onChange={setPassword}
          htmlName="password"
          size="lg"
          isRequired
          status={passwordStatus}
        />

        <TextInput
          type="password"
          label="Confirm password"
          placeholder="••••••••"
          value={confirm}
          onChange={setConfirm}
          htmlName="confirm_password"
          size="lg"
          isRequired
          status={confirmStatus}
        />

        <div className="vibe-cta vibe-cta--stack flex flex-col gap-3">
          <Button
            label={submitting ? 'Creating account…' : 'Register'}
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
          />
          <GoogleButton />
        </div>
      </form>
    </AuthShell>
  );
}
