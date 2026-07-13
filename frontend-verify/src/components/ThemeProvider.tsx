// Client-side wrapper around next-themes, so the server-rendered root layout can stay
// a server component while still mounting the provider.
//
// next-themes puts the active theme on <html> as a class ("light" / "dark"), which is
// what both halves of the theming rely on:
//   - Tailwind's `dark:` variant, keyed to that class in globals.css.
//   - Astryx's design tokens, which are declared with CSS light-dark() and so follow
//     the `color-scheme` that globals.css sets from the same class. That's what makes
//     the design-system components (SideNav, TextInput, Card…) go dark without any
//     per-component work.

'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemeProvider>
  );
}
