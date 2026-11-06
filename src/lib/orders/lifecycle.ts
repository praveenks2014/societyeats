import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { orderEvents, orders, payments } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { formatINR } from '@/lib/money';
import { releaseCredit } from '@/lib/referrals';
import { performOrderAction } from './actions';
import { nextOrderStatus } from './state';
import { releaseStock } from './stock';
import { notifyAdmins } from './strikes';

/**
 * Timers. Every deadline is DERIVED from timestamps and enforced lazily — whenever an order is read or acted
 * on (applyOrderTimers) — AND by the scheduled job (runOrderTimers, every 5 minutes), so a missed cron can delay
 * a notification but never leave an order in the wrong state. Each transition is a conditional UPDATE, so
 * lazy and scheduled enforcement can race safely: exactly one wins.
 */

/** fee_pending orders whose platform fee was not paid in time → expired; stock and credit are released. */
export async function expireUnpaidOrders(now: Date = new Date(), onlyOrderId?: number): Promise<number> {
  const db = await getDb();
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'fee_pending'), eq(orders.type, 'home_delivery'), lt(orders.expiresAt, now), onlyOrderId ? eq(orders.id, onlyOrderId) : undefined));
  let n = 0;
  for (const { id } of stale) {
    const done = await db.transaction(async (tx) => {
      const [o] = await tx
        .update(orders)
        .set({ status: nextOrderStatus('fee_pending', 'expire', 'system'), cancelReason: 'Platform fee not paid in time', cancelledAt: now, cancelledBy: 'system', updatedAt: now })
        .where(and(eq(orders.id, id), eq(orders.status, 'fee_pending')))
        .returning();
      if (!o) return false;
      await releaseStock(tx, id);
      await releaseCredit(tx, id);
      await tx.update(payments).set({ status: 'failed' }).where(and(eq(payments.orderId, id), inArray(payments.status, ['created', 'authorized'])));
      await tx.insert(orderEvents).values({ orderId: id, status: 'expired', note: 'Expired — platform fee was not paid in time' });
      return true;
    });
    if (done) n++;
  }
  return n;
}

/** Booked orders the kitchen never accepted in `sellerAcceptWindowMinutes` → cancelled_auto, fee refunded, kitchen gets a "missed" strike. */
export async function autoCancelUnaccepted(now: Date = new Date(), onlyOrderId?: number): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'booked'), eq(orders.type, 'home_delivery'), lt(orders.acceptBy, now), onlyOrderId ? eq(orders.id, onlyOrderId) : undefined));
  let n = 0;
  for (const { id } of rows) {
    try {
      await performOrderAction(id, { action: 'auto_cancel', actor: 'system', actorId: null, now });
      n++;
    } catch (e) {
      log.warn('order.auto_cancel_skipped', { orderId: id, err: e });
    }
  }
  return n;
}

/** The buyer said "I've paid" and the kitchen neither confirmed nor disputed within `sellerConfirmPaymentHours` → completed. */
export async function autoCompleteUnconfirmed(now: Date = new Date(), onlyOrderId?: number): Promise<number> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const cutoff = new Date(now.getTime() - settings.sellerConfirmPaymentHours * 3_600_000);
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'payment_claimed'), lt(orders.foodPaymentClaimedAt, cutoff), onlyOrderId ? eq(orders.id, onlyOrderId) : undefined));
  let n = 0;
  for (const { id } of rows) {
    try {
      await performOrderAction(id, { action: 'auto_complete', actor: 'system', actorId: null, now });
      n++;
    } catch (e) {
      log.warn('order.auto_complete_skipped', { orderId: id, err: e });
    }
  }
  return n;
}

/**
 * One-time nudges (never a state change):
 *  - collected, but no "I've paid" within `paymentClaimMinutes` → remind the buyer; tell the kitchen it may raise a dispute
 *  - payment_claimed, and the kitchen has not answered within `kitchenPaymentConfirmMinutes` → remind the kitchen
 */
export async function sendPaymentReminders(now: Date = new Date(), onlyOrderId?: number): Promise<number> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  let n = 0;

  const claimCutoff = new Date(now.getTime() - settings.paymentClaimMinutes * 60_000);
  const waiting = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, 'collected'), lt(orders.collectedAt, claimCutoff), isNull(orders.buyerPaymentRemindedAt), onlyOrderId ? eq(orders.id, onlyOrderId) : undefined));
  for (const o of waiting) {
    const [won] = await db.update(orders).set({ buyerPaymentRemindedAt: now }).where(and(eq(orders.id, o.id), isNull(orders.buyerPaymentRemindedAt))).returning({ id: orders.id });
    if (!won) continue;
    n++;
    await notify(o.buyerId, `Order #${o.id}: please pay the kitchen`, `You collected your food — pay ${formatINR(o.foodTotalInPaise)} to the kitchen, then tap “I've paid”.`, `/orders/${o.id}`);
    if (o.sellerId) await notify(o.sellerId, `Order #${o.id}: still unpaid`, 'The buyer has not marked the payment yet. You can raise a dispute from the order if needed.', '/seller/orders');
  }

  const confirmCutoff = new Date(now.getTime() - settings.kitchenPaymentConfirmMinutes * 60_000);
  const unconfirmed = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, 'payment_claimed'), lt(orders.foodPaymentClaimedAt, confirmCutoff), isNull(orders.kitchenPaymentRemindedAt), onlyOrderId ? eq(orders.id, onlyOrderId) : undefined));
  for (const o of unconfirmed) {
    const [won] = await db.update(orders).set({ kitchenPaymentRemindedAt: now }).where(and(eq(orders.id, o.id), isNull(orders.kitchenPaymentRemindedAt))).returning({ id: orders.id });
    if (!won) continue;
    n++;
    if (o.sellerId) await notify(o.sellerId, `Please confirm payment for order #${o.id}`, `The buyer says they paid ${formatINR(o.foodTotalInPaise)}. Tap “Payment received” or “Not received”.`, '/seller/orders');
    await notify(o.buyerId, `Order #${o.id}: waiting for the kitchen to confirm`, 'We nudged the kitchen. Your order is not cancelled.', `/orders/${o.id}`);
  }
  return n;
}

/** Lazy enforcement for a single order, called on every read/act. */
export async function applyOrderTimers(orderId: number, now: Date = new Date()): Promise<void> {
  await expireUnpaidOrders(now, orderId);
  await autoCancelUnaccepted(now, orderId);
  await autoCompleteUnconfirmed(now, orderId);
}

export async function runOrderTimers(now: Date = new Date()) {
  const expired = await expireUnpaidOrders(now);
  const autoCancelled = await autoCancelUnaccepted(now);
  const autoCompleted = await autoCompleteUnconfirmed(now);
  const reminders = await sendPaymentReminders(now);
  return { expired, autoCancelled, autoCompleted, reminders };
}

export { notifyAdmins };
