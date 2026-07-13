// VibeNet — Google OAuth success landing (route: "/auth/google-success").
//
// After a successful Google sign-in the backend redirects the browser here with
// the issued JWT in the query string: ?token=<jwt>. We read it client-side,
// derive the user from the token's claims, persist the session, and hand off to
// the dashboard. The token is stripped from the URL right after so it isn't left
// in the browser history. Anything malformed sends the user back to /login.

'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { gooeyToast } from 'goey-toast';
import { Text } from '@astryxdesign/core/Text';
import { Spinner } from '@astryxdesign/core/Spinner';
import { saveSession } from '@/lib/session';
import type { AuthUser } from '@/lib/api';

// Decode a JWT's payload (base64url) without verifying the signature — we only
// need the user_id/username claims to populate the session for display. The
// signature is still enforced by the backend on every authenticated request.
function decodeTokenUser(token: string): AuthUser {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('malformed token');
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
    user_id?: string;
    username?: string;
  };
  if (!claims.user_id || !claims.username) throw new Error('missing claims');
  // The JWT carries no display_name; seed it from the username as a placeholder.
  // useAuth's GET /api/user/me refresh replaces this with the real name moments later.
  return {
    user_id: claims.user_id,
    username: claims.username,
    display_name: claims.username,
  };
}

// Shared loading UI, also used as the Suspense fallback so the transition is seamless.
function Authenticating() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16">
      <Spinner />
      <Text type="body" color="secondary">
        Authenticating…
      </Text>
    </main>
  );
}

function GoogleSuccess() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      gooeyToast.error('Google sign-in did not complete. Please try again.');
      router.replace('/login');
      return;
    }

    try {
      const user = decodeTokenUser(token);
      saveSession({ token, user });
      // Clear the token from the URL so it isn't left in history.
      window.history.replaceState(null, '', '/auth/google-success');
      gooeyToast.success(`Signed in as ${user.username}`);
      router.replace('/dashboard');
    } catch {
      gooeyToast.error('Could not read the sign-in response. Please try again.');
      router.replace('/login');
    }
  }, [router, searchParams]);

  return <Authenticating />;
}

// useSearchParams must be read inside a Suspense boundary, otherwise the static
// production build fails with the "Missing Suspense boundary" error (Next 16).
export default function GoogleSuccessPage() {
  return (
    <Suspense fallback={<Authenticating />}>
      <GoogleSuccess />
    </Suspense>
  );
}
