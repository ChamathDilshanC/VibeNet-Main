// Global site footer for VibeNet.
//
// Rendered once from the root layout. Shows on the marketing and auth pages, but
// hides on the full-height app shell (/dashboard): there a marketing footer is out of
// place and pushes the layout past the viewport, adding a scrollbar to what should be
// a fixed, single-screen chat UI.
//
// Settings used to have a route of its own and needed listing here too; it now renders
// inside the dashboard shell, so /dashboard covers it.

'use client';

import { usePathname } from 'next/navigation';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';

// Route prefixes rendered inside the full-height app shell, where the footer is
// suppressed. Everything else (landing, /login, /register, /auth/*) keeps it.
const APP_ROUTES = ['/dashboard'];

export function Footer() {
  const pathname = usePathname();
  const isAppRoute = APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  if (isAppRoute) return null;

  const year = new Date().getFullYear();

  return (
    <footer className="vibe-footer">
      <div className="vibe-footer__inner">
        <Text type="supporting" color="secondary">
          Developed by{' '}
          <Link href="https://github.com/ChamathDilshanC" isExternalLink>
            Chamath Dilshan
          </Link>
        </Text>
        <Text type="supporting" color="secondary">
          © {year} VibeNet. All rights reserved.
        </Text>
      </div>
    </footer>
  );
}
