import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db';
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

/** A db handle or an open transaction — credit helpers work inside either. */
export type DbLike = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

/**
 * Reserves up to `amountPaise` of the buyer's available credit for `orderId`,
 * oldest rows first. A row larger than what is needed is SPLIT: the needed
 * part becomes a 'reserved' row attached to the order and the remainder stays
 * 'available' — so partial use never discards the rest. Reserved credit is
 * consumed when the platform fee is paid and released if the order fails or
 * expires. Returns the amount actually reserved.
 */
export async function reserveCredit(tx: DbLike, buyerId: number, orderId: number, amountPaise: number): Promise<number> {
  if (amountPaise <= 0) return 0;
  const rows = await tx
    .select()
    .from(referralCredits)
    .where(and(eq(referralCredits.buyerId, buyerId), eq(referralCredits.status, 'available')))
    .orderBy(asc(referralCredits.createdAt), asc(referralCredits.id));

  let remaining = amountPaise;
  let reserved = 0;
  for (const row of rows) {
    if (remaining <= 0) break;
    if (row.amountInPaise <= remaining) {
      await tx.update(referralCredits).set({ status: 'reserved', appliedToOrderId: orderId }).where(eq(referralCredits.id, row.id));
      remaining -= row.amountInPaise;
      reserved += row.amountInPaise;
    } else {
      await tx.update(referralCredits).set({ amountInPaise: row.amountInPaise - remaining }).where(eq(referralCredits.id, row.id));
      await tx.insert(referralCredits).values({
        buyerId,
        referredUserId: row.referredUserId,
        referredOrderId: row.referredOrderId,
        amountInPaise: remaining,
        status: 'reserved',
        appliedToOrderId: orderId,
        createdAt: row.createdAt,
      });
      reserved += remaining;
      remaining = 0;
    }
  }
  return reserved;
}

/** Reserved → applied (the platform fee was paid). */
export async function consumeReservedCredit(tx: DbLike, orderId: number): Promise<void> {
  await tx
    .update(referralCredits)
    .set({ status: 'applied', appliedAt: new Date() })
    .where(and(eq(referralCredits.appliedToOrderId, orderId), eq(referralCredits.status, 'reserved')));
}

/**
 * Reserved/applied → available again (payment failed, order expired or was
 * cancelled with a full platform-fee refund). Idempotent.
 */
export async function releaseCredit(tx: DbLike, orderId: number): Promise<number> {
  const rows = await tx
    .update(referralCredits)
    .set({ status: 'available', appliedToOrderId: null, appliedAt: null })
    .where(and(eq(referralCredits.appliedToOrderId, orderId), inArray(referralCredits.status, ['reserved', 'applied'])))
    .returning({ amount: referralCredits.amountInPaise });
  return rows.reduce((s, r) => s + r.amount, 0);
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
  // Count distinct referred neighbours, not rows — split rows are one grant.
  const grantedSoFar = await db
    .selectDistinct({ referredUserId: referralCredits.referredUserId })
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
