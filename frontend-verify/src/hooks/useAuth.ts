// Client-side auth guard for pages that require a signed-in session.
//
// Hydrates immediately from the session saved at login/OAuth time (see
// lib/session.ts) so protected pages render without waiting on the network,
// then refreshes from GET /api/user/me in the background. That refresh is what
// surfaces fields the JWT never carried — the Google `avatar_url` — and picks up
// a username changed from settings or another device.
//
// Redirects to /login when no token is present, or when the server rejects the
// stored token as expired/invalid. `ready` stays false until the guard has
// resolved, so callers can avoid flashing protected content.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { gooeyToast } from 'goey-toast';
import { getToken, getUser, saveUser, clearSession } from '@/lib/session';
import { fetchMe } from '@/lib/user';
import { ApiError, type AuthUser } from '@/lib/api';

type AuthState =
  | { ready: false; user: null }
  | { ready: true; user: AuthUser | null };

const PENDING: AuthState = { ready: false, user: null };

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>(PENDING);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setState({ ready: true, user: getUser() });

    let cancelled = false;
    void (async () => {
      try {
        const fresh = await fetchMe();
        if (cancelled) return;
        saveUser(fresh);
        setState({ ready: true, user: fresh });
      } catch (err) {
        if (cancelled) return;
        // An expired or revoked token can't be recovered from — send them back
        // to /login rather than leaving a half-authenticated page up. Any other
        // failure (backend down, offline) keeps the cached session usable.
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          router.replace('/login');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Applies a profile the caller just persisted server-side (settings page), so
  // the stored session and every mounted useAuth agree without a reload.
  const updateUser = useCallback((user: AuthUser) => {
    saveUser(user);
    setState({ ready: true, user });
  }, []);

  // Logout is a two-step confirm: the button raises a toast, and only its action
  // button actually clears the session — dismissing (or ignoring) it cancels. The
  // fixed id means hammering the button re-uses one toast instead of stacking them.
  function logout() {
    gooeyToast.warning('Log out of VibeNet?', {
      id: 'logout-confirm',
      description: 'Your session on this device will be cleared.',
      duration: 8000,
      action: {
        label: 'Log out',
        onClick: () => {
          clearSession();
          gooeyToast('Signed out.', {
            description: 'Your session on this device was cleared.',
          });
          router.replace('/login');
        },
      },
    });
  }

  return { ...state, logout, updateUser };
}
