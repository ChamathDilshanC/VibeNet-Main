// VibeNet — WhatsApp-style delivery ticks.
//
// Its own file (rather than living in ChatView.tsx, where it originated) so
// MessageAttachment.tsx can reuse it for the ticks overlaid on image bubbles
// without ChatView and MessageAttachment importing each other.

import type { MessageStatus } from '@/lib/messageStore';

const STATUS_LABEL: Record<MessageStatus, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

// Sized to sit next to a timestamp inside the sender bubble: one tick when
// only the server has it, two once the recipient is online and received it,
// and a deep-blue double tick once they've read it — which "lights up"
// against the lighter logo-blue bubble.
export function DeliveryTicks({ status }: { status: MessageStatus }) {
  const isDouble = status !== 'sent';
  const isRead = status === 'read';
  const color = isRead ? 'text-[#0b3f8f]' : status === 'delivered' ? 'text-white/90' : 'text-white/70';
  return (
    <span role="img" aria-label={STATUS_LABEL[status]} className={`inline-flex ${color}`}>
      <svg
        width="16"
        height="11"
        viewBox="0 0 16 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true">
        <path d="M1 6l3 3 5.5-6.5" />
        {isDouble && <path d="M6.5 9l5.5-6.5" />}
      </svg>
    </span>
  );
}
