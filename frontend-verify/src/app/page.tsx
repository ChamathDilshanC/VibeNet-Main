// VibeNet — landing page (route: "/").
//
// Adapted from the Astryx "side-gallery" template: brand, marketing copy, and the
// two primary CTAs (Login / Register) sit on the left, with an image collage on
// the right. Layout and spacing are handled with Tailwind utilities; the design
// system provides the typography (<Text>), CTAs (<Button>), and <Divider>.
//
// The main content is width-constrained and horizontally centered (mx-auto +
// max-w-7xl), pushed down from the top edge with generous top padding, and it
// collapses to a single stacked column on small screens.

'use client';

import { useRouter } from 'next/navigation';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';

// ─── Image Data ─────────────────────────────────────────────────────────────
// Curated, high-resolution collage served from /public/gallery.
// Source: Unsplash (free to use). Arranged for a balanced spread of colour.

const IMAGES = [
  { id: 1, src: '/gallery/g1.jpg', alt: 'Flowing gradient of violet, blue, and cyan' },
  { id: 2, src: '/gallery/g2.jpg', alt: 'Glowing low-poly geometric pattern' },
  { id: 3, src: '/gallery/g3.jpg', alt: 'Red and blue ink swirling through water' },
  { id: 4, src: '/gallery/g4.jpg', alt: 'Smooth indigo-to-magenta gradient' },
  { id: 5, src: '/gallery/g5.jpg', alt: 'Rainbow-lit architectural corridor' },
  { id: 6, src: '/gallery/g6.jpg', alt: 'Calm teal-to-blue gradient' },
  { id: 7, src: '/gallery/g7.jpg', alt: 'Deep blue and red light gradient' },
  { id: 8, src: '/gallery/g8.jpg', alt: 'Soft rainbow pastel gradient' },
  { id: 9, src: '/gallery/g9.jpg', alt: 'Cobalt-blue liquid abstract' },
];

// ─── Stat Block ─────────────────────────────────────────────────────────────

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <Text type="large" weight="bold" className="vibe-gradient-text">
        {value}
      </Text>
      <Text type="supporting" color="secondary">
        {label}
      </Text>
    </div>
  );
}

// ─── Image Grid ─────────────────────────────────────────────────────────────

function ImageGrid() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {IMAGES.map((img) => (
        <div
          key={img.id}
          className="vibe-tile aspect-square overflow-hidden rounded-[var(--radius-element)]"
        >
          <img
            src={img.src}
            alt={img.alt}
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-24 pb-16 md:pt-32 lg:px-8">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left: brand, description, and auth CTAs */}
        <div className="flex flex-col gap-6">
          {/* Brand wordmark doubles as the page's h1 (alt = "VibeNet"). */}
          <h1 className="vibe-logo">
            <img
              src="/logo/vibenet-logo.png"
              alt="VibeNet"
              width={1787}
              height={521}
              className="h-auto w-24 sm:w-28 md:w-32"
            />
          </h1>

          <div className="flex flex-col gap-3">
            <Text type="supporting" weight="semibold" className="vibe-eyebrow">
              END-TO-END ENCRYPTED
            </Text>
            <Text type="body" color="secondary">
              Secure, real-time end-to-end encrypted chat. Your conversations are
              encrypted on your device and never leave it in the clear — not to
              the network, not to our servers, not to anyone but the people you
              talk to.
            </Text>
          </div>

          {/* Auth CTAs — ready to point at the auth routes as they ship. */}
          <div className="vibe-cta flex flex-wrap items-center gap-3">
            <Button
              label="Register"
              variant="primary"
              size="lg"
              onClick={() => router.push('/register')}
            />
            <Button
              label="Login"
              variant="secondary"
              size="lg"
              onClick={() => router.push('/login')}
            />
          </div>

          <div className="flex flex-col gap-4">
            <Divider />
            <div className="flex flex-wrap gap-6">
              <StatBlock value="E2EE" label="By default" />
              <StatBlock value="Real-time" label="Messaging" />
              <StatBlock value="Zero-knowledge" label="Servers" />
            </div>
          </div>
        </div>

        {/* Right: image collage */}
        <ImageGrid />
      </div>
    </main>
  );
}
