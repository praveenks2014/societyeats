'use client';

import { Badge } from '@/components/ui';

export const STATUS_META: Record<string, { label: string; emoji: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  placed: { label: 'Placed — pay the platform fee to send it', emoji: '🕐', tone: 'neutral' },
  fee_paid: { label: 'Sent to the kitchen', emoji: '🍲', tone: 'amber' },
  awaiting_kitchen_payment_confirmation: { label: 'Kitchen confirming your UPI payment', emoji: '⏳', tone: 'amber' },
  expired: { label: 'Expired — platform fee not paid', emoji: '⌛', tone: 'red' },
  paid: { label: 'Paid — waiting for the kitchen', emoji: '✅', tone: 'amber' },
  accepted: { label: 'Accepted by the kitchen', emoji: '👩‍🍳', tone: 'amber' },
  preparing: { label: 'Cooking now', emoji: '🍳', tone: 'amber' },
  ready: { label: 'Ready', emoji: '🛎️', tone: 'green' },
  out_for_delivery: { label: 'Out for delivery', emoji: '🛵', tone: 'green' },
  delivered: { label: 'Delivered', emoji: '🎉', tone: 'green' },
  picked_up: { label: 'Picked up', emoji: '🛍️', tone: 'green' },
  cancelled: { label: 'Cancelled', emoji: '✖️', tone: 'red' },
  refund_pending: { label: 'Refund on the way', emoji: '↩️', tone: 'red' },
  delivery_unassigned: { label: 'Finding a rider…', emoji: '📡', tone: 'red' },
};

export function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, emoji: '•', tone: 'neutral' as const };
  return (
    <Badge tone={meta.tone}>
      {meta.emoji} {meta.label}
    </Badge>
  );
}

export function OrderTimeline({
  events,
}: {
  events: { id: number; status: string; note: string | null; createdAt: string }[];
}) {
  return (
    <ol className="relative space-y-4 border-l-2 border-rice-line pl-5">
      {events.map((e, i) => {
        const meta = STATUS_META[e.status];
        const isLast = i === events.length - 1;
        return (
          <li key={e.id} className="relative">
            <span
              className={`absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-rice ${
                isLast ? 'bg-leaf' : 'bg-rice-line'
              }`}
            >
              {isLast && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <div className={`text-sm font-semibold ${isLast ? 'text-leaf' : ''}`}>
              {meta ? `${meta.emoji} ${meta.label}` : e.status}
            </div>
            {e.note && <div className="text-xs text-ink-soft">{e.note}</div>}
            <div className="mt-0.5 text-[11px] text-ink-faint">
              {new Date(e.createdAt).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
