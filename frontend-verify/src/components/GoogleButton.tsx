// "Continue with Google" button, shared by the Login and Register pages.
//
// It's a full-page navigation (an <a>, not fetch) to the backend's Google login
// endpoint, which redirects to Google's consent screen. The icon is the official
// multi-color Google "G" mark, inlined so it needs no network request.

'use client';

import { googleLoginUrl } from '@/lib/api';

function GoogleIcon() {
  return (
    <svg
      className="vibe-google-btn__icon"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.858-3.048.858-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.709A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.709V4.959H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.041l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.959L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  return (
    <a href={googleLoginUrl()} className="vibe-google-btn">
      <GoogleIcon />
      {label}
    </a>
  );
}
