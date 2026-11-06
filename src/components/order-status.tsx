'use client';

import { Badge } from '@/components/ui';

export const STATUS_META: Record<string, { label: string; emoji: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  fee_pending: { label: 'Pay the platform fee to book', emoji: '🕐', tone: 'neutral' },
  booked: { label: 'Booked — waiting for the kitchen', emoji: '🍲', tone: 'amber' },
  awaiting_kitchen_payment_confirmation: { label: 'Kitchen confirming payment', emoji: '⏳', tone: 'amber' },
  expired: { label: 'Expired — platform fee not paid', emoji: '⌛', tone: 'red' },
  paid: { label: 'Paid — waiting for the kitchen', emoji: '✅', tone: 'amber' },
  accepted: { label: 'Accepted by the kitchen', emoji: '👩‍🍳', tone: 'amber' },
  preparing: { label: 'Cooking now', emoji: '🍳', tone: 'amber' },
  ready: { label: 'Ready', emoji: '🛎️', tone: 'green' },
  on_the_way: { label: 'On the way', emoji: '🛵', tone: 'green' },
  at_door: { label: 'At your door — pay the kitchen', emoji: '🚪', tone: 'green' },
  collected: { label: 'Collected — pay the kitchen', emoji: '🥡', tone: 'green' },
  payment_claimed: { label: 'Payment sent — kitchen confirming', emoji: '💸', tone: 'amber' },
  completed: { label: 'Completed', emoji: '🎉', tone: 'green' },
  payment_disputed: { label: 'Payment under review', emoji: '🔍', tone: 'red' },
  closed_unpaid: { label: 'Closed — unpaid', emoji: '✖️', tone: 'red' },
  cancelled_by_seller: { label: 'Cancelled by the kitchen', emoji: '✖️', tone: 'red' },
  cancelled_by_buyer: { label: 'Cancelled by you', emoji: '✖️', tone: 'neutral' },
  cancelled_auto: { label: 'Cancelled — kitchen did not respond', emoji: '✖️', tone: 'red' },
  cancelled_buyer_unpaid: { label: 'Cancelled — not paid at the door', emoji: '✖️', tone: 'red' },
  no_show_buyer: { label: 'Cancelled — buyer not at the door', emoji: '✖️', tone: 'red' },
  delivered: { label: 'Delivered', emoji: '🎉', tone: 'green' },
  picked_up: { label: 'Picked up', emoji: '🛍️', tone: 'green' },
  cancelled: { label: 'Cancelled', emoji: '✖️', tone: 'red' },
  refund_pending: { label: 'Refund on the way', emoji: '↩️', tone: 'red' },
  delivery_unassigned: { label: 'Finding a rider…', emoji: '📡', tone: 'red' },
};

/** Statuses after which nothing more will happen on an order. */
export const FINISHED_STATUSES = ['completed', 'closed_unpaid', 'cancelled_by_seller', 'cancelled_by_buyer', 'cancelled_auto', 'cancelled_buyer_unpaid', 'no_show_buyer', 'expired', 'cancelled', 'delivered', 'picked_up', 'refund_pending'];
export const COMPLETED_STATUSES = ['completed', 'delivered', 'picked_up'];

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
