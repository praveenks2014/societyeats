import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orders, referralCredits, users } from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';
import { notify } from '@/lib/db/notify';

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics,
 * DECISIONS.md #87+). A neighbour-referral credit program: share your code
 * (or link) via WhatsApp, and the first time someone who used it completes
 * their first order, you (the referrer) get a fixed ₹30 (admin-configurable)
 * credit toward your own next checkout. Capped at a lifetime number of
 * credits per referrer.
 */

/**
 * Short, unique-by-construction referral code derived from the user's id —
 * no collision retries needed (unlike a random string), same "derive from an
 * already-unique key" approach as src/lib/payouts.ts's fyLabel().
 */
export function referralCodeFor(userId: number): string {
  return `PP${userId.toString(36).toUpperCase()}`;
}

/** Sum of a buyer's still-unspent referral credit, in paise. */
export async function availableCreditPaise(buyerId: number): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ amountInPaise: referralCredits.amountInPaise })
    .from(referralCredits)
    .where(and(eq(referralCredits.buyerId, buyerId), eq(referralCredits.status, 'available')));
  return rows.reduce((sum, r) => sum + r.amountInPaise, 0);
}

/**
 * Marks a buyer's oldest available credit rows as spent against `orderId`,
 * up to `amountPaise` — whole rows only (every grant is a fixed amount, and
 * the caller already caps `amountPaise` at the buyer's real balance), so
 * there's never a partial-row remainder to track. Returns the amount
 * actually applied (== amountPaise as long as the caller passed a value the
 * buyer can actually cover).
 */
export async function applyCredit(buyerId: number, orderId: number, amountPaise: number): Promise<number> {
  if (amountPaise <= 0) return 0;
  const db = await getDb();
  const rows = await db
    .select()
    .from(referralCredits)
    .where(and(eq(referralCredits.buyerId, buyerId), eq(referralCredits.status, 'available')))
    .orderBy(asc(referralCredits.createdAt));

  let remaining = amountPaise;
  let applied = 0;
  const idsToApply: number[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    idsToApply.push(row.id);
    remaining -= row.amountInPaise;
    applied += row.amountInPaise;
  }
  if (idsToApply.length > 0) {
    await db
      .update(referralCredits)
      .set({ status: 'applied', appliedToOrderId: orderId, appliedAt: new Date() })
      .where(inArray(referralCredits.id, idsToApply));
  }
  return applied;
}

/**
 * Grants the referrer's credit the moment a referred neighbour's order first
 * reaches a terminal completed state (delivered/picked_up) — called from the
 * OTP verify route right after that transition. Deliberately gated on
 * *completion*, not placement, so a placed-then-cancelled order can't be
 * used to farm credit. Idempotent (checked by referredUserId, not orderId,
 * since only the buyer's very first completed order can ever qualify) and
 * capped at DEFAULTS.referralCreditCapPerUser lifetime grants per referrer.
 */
export async function maybeGrantReferralCredit(order: { id: number; buyerId: number }): Promise<void> {
  const db = await getDb();
  const [buyer] = await db.select().from(users).where(eq(users.id, order.buyerId));
  if (!buyer?.referredByUserId) return;

  const completed = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.buyerId, order.buyerId), inArray(orders.status, ['delivered', 'picked_up'])));
  const isFirstCompleted = completed.length === 1 && completed[0].id === order.id;
  if (!isFirstCompleted) return;

  const already = await db
    .select({ id: referralCredits.id })
    .from(referralCredits)
    .where(eq(referralCredits.referredUserId, order.buyerId));
  if (already.length > 0) return; // already granted for this referred neighbour

  const settings = await getPlatformSettings();
  const grantedSoFar = await db
    .select({ id: referralCredits.id })
    .from(referralCredits)
    .where(eq(referralCredits.buyerId, buyer.referredByUserId));
  if (grantedSoFar.length >= settings.referralCreditCapPerUser) return;

  await db.insert(referralCredits).values({
    buyerId: buyer.referredByUserId,
    referredUserId: order.buyerId,
    referredOrderId: order.id,
    amountInPaise: settings.referralCreditPaise,
  });
  await notify(
    buyer.referredByUserId,
    `You earned ₹${(settings.referralCreditPaise / 100).toFixed(0)} credit! 🎉`,
    `${buyer.name} placed their first order using your invite. Apply the credit at your next checkout.`,
    '/refer',
  );
}
