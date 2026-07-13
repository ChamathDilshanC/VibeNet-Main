// VibeNet — typing indicator.
//
// Three dots bouncing in sequence inside a sleek glassmorphic pill, driven by
// framer-motion. Rendered above the composer while a peer is actively typing
// (see ChatView); the parent owns show/hide + the 3-second inactivity timeout.

'use client';

import { motion } from 'framer-motion';

const DOT_COUNT = 3;

export function TypingIndicator({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label ? `${label} is typing` : 'Typing'}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/60 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/70 px-3 py-2 shadow-[0_4px_16px_rgba(37,63,132,0.10)] backdrop-blur-md">
      {Array.from({ length: DOT_COUNT }).map((_, i) => (
        <motion.span
          key={i}
          className="block h-2 w-2 rounded-full bg-[var(--vibe-blue)]"
          animate={{ y: [0, -4, 0], opacity: [0.35, 1, 0.35] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}
