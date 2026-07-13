// App-wide toast layer, mounted once in the root layout.
//
// Wraps goey-toast's <GooeyToaster/> in a client boundary and sets the
// VibeNet-wide defaults (position, brand-friendly animation). The theme follows
// next-themes so toasts render dark surfaces in dark mode instead of glaring
// white cards. Fire toasts from anywhere with `gooeyToast(...)`.

'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { GooeyToaster } from 'goey-toast';

export function Toaster() {
  const { resolvedTheme } = useTheme();
  // next-themes only knows the real theme after reading the DOM on the client;
  // render the default until then so hydration markup matches the server's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration flag
    setMounted(true);
  }, []);

  return (
    <GooeyToaster
      position="top-right"
      theme={mounted && resolvedTheme === 'dark' ? 'dark' : 'light'}
      richColors
      closeButton
      expand
      preset="smooth"
    />
  );
}
