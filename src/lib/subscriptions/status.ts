import { DAY_MS, addMonthsIST } from '@/lib/time';

export type SubStatus = 'pending_payment' | 'active' | 'grace' | 'expired' | 'waived' | 'cancelled';

export type SubLike = {
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

/**
 * The status a subscription has RIGHT NOW. Stored status only changes on
 * payment/admin actions and on the cron sweep; this derives the time-based
 * transitions so listings hide the moment grace ends, even before any sweep.
 *   active  --(now >= endsAt)-->  grace  --(now >= endsAt + graceDays)--> expired
 * 'waived' (admin-granted free period) behaves like active but keeps its label.
 */
export function effectiveStatus(sub: SubLike, now: Date, graceDays: number): SubStatus {
  const s = sub.status as SubStatus;
  if (s === 'pending_payment' || s === 'cancelled') return s;
  if (!sub.endsAt || !sub.startsAt) return s === 'expired' ? 'expired' : 'pending_payment';
  if (now < sub.startsAt) return 'pending_payment'; // a stacked, not-yet-started period
  if (now < sub.endsAt) return s === 'waived' ? 'waived' : 'active';
  const graceEnd = new Date(sub.endsAt.getTime() + graceDays * DAY_MS);
  if (now < graceEnd) return 'grace';
  return 'expired';
}

/** A kitchen is "subscribed" (listable) while any of its periods is active, waived or in grace. */
export function isSubscribed(subs: SubLike[], now: Date, graceDays: number): boolean {
  return subs.some((s) => ['active', 'waived', 'grace'].includes(effectiveStatus(s, now, graceDays)));
}

/** The current best status across all of a kitchen's periods (active > waived > grace > expired > none). */
export function overallStatus(subs: SubLike[], now: Date, graceDays: number): SubStatus | 'none' {
  const order: SubStatus[] = ['active', 'waived', 'grace', 'expired', 'pending_payment', 'cancelled'];
  const statuses = subs.map((s) => effectiveStatus(s, now, graceDays));
  for (const o of order) if (statuses.includes(o) && o !== 'pending_payment' && o !== 'cancelled') return o;
  return 'none';
}

/** Latest end across periods that count (paid/active/waived), used to stack renewals. */
export function latestEnd(subs: SubLike[]): Date | null {
  let max: Date | null = null;
  for (const s of subs) {
    if (['pending_payment', 'cancelled'].includes(s.status) || !s.endsAt) continue;
    if (!max || s.endsAt > max) max = s.endsAt;
  }
  return max;
}

/**
 * Early renewal stacks: the new period starts at the current end when that is
 * still in the future; otherwise it starts now.
 */
export function nextPeriod(subs: SubLike[], durationMonths: number, now: Date): { startsAt: Date; endsAt: Date } {
  const end = latestEnd(subs);
  const startsAt = end && end > now ? end : now;
  return { startsAt, endsAt: addMonthsIST(startsAt, durationMonths) };
}

/** Whole days until the CURRENT period (the one containing now, else latest) ends. */
export function daysLeft(subs: SubLike[], now: Date): number | null {
  const end = latestEnd(subs);
  if (!end) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}
