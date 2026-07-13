// VibeNet — Login (route: "/login").
//
// Posts { username, password } to the backend's POST /api/auth/login and, on
// success, stores the returned JWT + user and sends the person home. Also
// offers Google sign-in, which is a full-page redirect to the backend.

'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { gooeyToast } from 'goey-toast';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { AuthShell } from '@/components/AuthShell';
import { GoogleButton } from '@/components/GoogleButton';
import { login, ApiError } from '@/lib/api';
import { saveSession } from '@/lib/session';

// Surfaces a deactivated/deleted-account rejection bounced back from the Google
// OAuth callback (see GoogleCallback's loginBlockedReason redirect to
// /login?error=...) — the password-login path already reports the same rejection
// inline via ApiError, this only covers the full-page-redirect OAuth flow. Reads
// via useSearchParams, which Next 16 requires a Suspense boundary for.
function OAuthErrorToast() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const error = searchParams.get('error');
    if (!error) return;
    gooeyToast.error(error);
    window.history.replaceState(null, '', '/login');
  }, [searchParams]);
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!username.trim() || !password) {
      gooeyToast.warning('Enter your username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await login({ username: username.trim(), password });
      saveSession(result);
      gooeyToast.success(`Welcome back, ${result.user.username}!`);
      router.push('/dashboard');
    } catch (err) {
      gooeyToast.error(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your encrypted VibeNet workspace."
      footer={
        <Text type="supporting" color="secondary">
          New to VibeNet?{' '}
          <Link href="/register" className="vibe-link">
            Create an account
          </Link>
        </Text>
      }
    >
      <Suspense fallback={null}>
        <OAuthErrorToast />
      </Suspense>

      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <TextInput
          type="text"
          label="Username"
          placeholder="your-username"
          value={username}
          onChange={setUsername}
          htmlName="username"
          size="lg"
          isRequired
        />

        <TextInput
          type="password"
          label="Password"
          placeholder="••••••••"
          value={password}
          onChange={setPassword}
          htmlName="password"
          size="lg"
          isRequired
        />

        <div className="vibe-cta vibe-cta--stack flex flex-col gap-3">
          <Button
            label={submitting ? 'Logging in…' : 'Login'}
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
