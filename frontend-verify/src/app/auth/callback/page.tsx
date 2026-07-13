// VibeNet — OAuth callback landing (route: "/auth/callback").
//
// After a successful Google sign-in the backend redirects the browser here with
// the session in the URL *fragment*: #token=<jwt>&user=<base64url(JSON)>. We read
// it client-side (fragments never reach a server), persist the session, and hand
// off to the dashboard. Anything malformed sends the user back to /login.

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { gooeyToast } from 'goey-toast';
import { Text } from '@astryxdesign/core/Text';
import { Spinner } from '@astryxdesign/core/Spinner';
import { saveSession } from '@/lib/session';
import type { AuthUser } from '@/lib/api';

// Decode a base64url (RawURLEncoding) string into an object, UTF-8 safe.
function decodeUser(b64url: string): AuthUser {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as AuthUser;
}

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, '');
    const params = new Map(
      fragment
        .split('&')
        .filter(Boolean)
        .map((kv) => {
          const i = kv.indexOf('=');
          return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] as const;
        }),
    );

    const token = params.get('token');
    const userParam = params.get('user');

    if (!token || !userParam) {
      gooeyToast.error('Google sign-in did not complete. Please try again.');
      router.replace('/login');
      return;
    }

    try {
      const user = decodeUser(userParam);
      saveSession({ token, user });
      // Clear the token from the URL so it isn't left in history.
      window.history.replaceState(null, '', '/auth/callback');
      gooeyToast.success(`Signed in as ${user.username}`);
      router.replace('/dashboard');
    } catch {
      gooeyToast.error('Could not read the sign-in response. Please try again.');
      router.replace('/login');
    }
  }, [router]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16">
      <Spinner />
      <Text type="body" color="secondary">
        Signing you in…
      </Text>
    </main>
  );
}
