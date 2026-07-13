// Root layout for the VibeNet frontend.
//
// Responsibilities:
//   - Load global styles (Tailwind + Astryx reset/core/theme).
//   - Activate the Astryx "neutral" theme via the `data-astryx-theme` attribute
//     on <html>, so every Astryx component resolves its design tokens —
//     including typography (Figtree, via --font-family-body/-heading in
//     theme-neutral/theme.css). Fonts are the theme's responsibility; the app
//     doesn't load any of its own.
//   - Expose base document metadata.

import type { Metadata } from "next";
import "./globals.css";
import "goey-toast/styles.css";
import { Footer } from "@/components/Footer";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/Toaster";

export const metadata: Metadata = {
  title: "VibeNet — Secure, Real-time E2EE Chat",
  description:
    "VibeNet is a secure, real-time end-to-end encrypted chat application.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes writes the theme class onto <html> from an
    // inline script before React hydrates, so the server markup deliberately differs.
    <html
      lang="en"
      data-astryx-theme="neutral"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900 transition-colors duration-300 ease-in-out dark:bg-gray-950 dark:text-gray-100">
        <ThemeProvider>
          {children}
          <Footer />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
