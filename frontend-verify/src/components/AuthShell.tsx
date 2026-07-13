// Shared chrome for the Login and Register pages: a small brand logo, a title
// and subtitle, and a centered, width-constrained content column that matches
// the landing page's spacing and brand accents.

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Secondary line under the form, e.g. the link to the other auth page. */
  footer: ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-start gap-5">
          <Link href="/" aria-label="VibeNet home" className="vibe-logo">
            <img
              src="/logo/vibenet-logo.png"
              alt="VibeNet"
              width={1787}
              height={521}
              className="h-auto w-28"
            />
          </Link>
          <div className="flex flex-col gap-1.5">
            <Heading level={1} type="display-3">
              {title}
            </Heading>
            <Text type="body" color="secondary">
              {subtitle}
            </Text>
          </div>
        </div>

        {children}

        <div className="vibe-auth-footer">{footer}</div>
      </div>
    </main>
  );
}
