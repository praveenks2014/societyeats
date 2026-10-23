import { and, eq, inArray, lt, isNull } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { kitchenRefundsDue, orderEvents, orders, payments, users } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { formatINR } from '@/lib/money';
import { refundOrderPayment } from '@/lib/payments/refunds';
import { releaseCredit } from '@/lib/referrals';
import { nextOrderStatus, type Actor } from './state';
import { releaseStock } from './stock';

/**
 * Orders whose platform fee was never paid expire after
 * `unpaidOrderExpiryMinutes`: status → expired, stock released, referral
 * credit released. Safe to call any time (also lazily on read) and idempotent:
 * the conditional UPDATE means each order expires exactly once.
 */
export async function expireUnpaidOrders(now: Date = new Date(), onlyOrderId?: number): Promise<number> {
  const db = await getDb();
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'placed'), eq(orders.type, 'home_delivery'), lt(orders.expiresAt, now), onlyOrderId ? eq(orders.id, onlyOrderId) : undefined));
  let n = 0;
  for (const { id } of stale) {
    const done = await db.transaction(async (tx) => {
      const [o] = await tx
        .update(orders)
        .set({ status: nextOrderStatus('placed', 'expire', 'system'), cancelReason: 'Platform fee not paid in time', updatedAt: now })
        .where(and(eq(orders.id, id), eq(orders.status, 'placed')))
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

export type CancelReason = 'rejected' | 'not_accepted';

/**
 * Kitchen rejects, or never accepts in time: order → cancelled, stock and
 * credit released, the platform fee refunded in full through Razorpay
 * automatically, and — if the buyer had already paid the kitchen by UPI — a
 * "kitchen refund due" item for the food amount (the platform never held it).
 */
export async function cancelOrderWithRefund(orderId: number, opts: { actor: Actor; reason: CancelReason; note?: string }) {
  const db = await getDb();
  const action = opts.actor === 'system' ? 'auto_cancel' : 'reject';
  const [existing] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!existing) throw new ApiError(404, 'Order not found');
  const to = nextOrderStatus(existing.status, action, opts.actor);
  const cancelReason = opts.reason === 'rejected' ? `Declined by the kitchen${opts.note ? `: ${opts.note}` : ''}` : 'Kitchen did not respond in time';

  const cancelled = await db.transaction(async (tx) => {
    const [o] = await tx
      .update(orders)
      .set({ status: to, cancelReason, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, existing.status)))
      .returning();
    if (!o) return null;
    await releaseStock(tx, orderId);
    await tx.insert(orderEvents).values({ orderId, status: to, note: opts.reason === 'rejected' ? 'Order declined by the kitchen — platform fee refunded' : 'Kitchen did not respond — order cancelled, platform fee refunded' });
    return o;
  });
  if (!cancelled) throw new ApiError(409, 'This order was just updated — refresh and try again');

  // Refund of the platform fee (Razorpay). Credit used on the order is handed back.
  let refunded = false;
  if (cancelled.type === 'home_delivery' && cancelled.onlineChargeInPaise > 0) {
    try {
      await refundOrderPayment({ orderId, reason: cancelReason, initiatedBy: 'system' });
      refunded = true;
    } catch (e) {
      log.error('order.cancel_refund_failed', { orderId, err: e });
    }
  } else if (cancelled.type === 'mall_pickup') {
    try {
      await refundOrderPayment({ orderId, reason: cancelReason, initiatedBy: 'system' });
      refunded = true;
    } catch (e) {
      log.error('order.cancel_refund_failed', { orderId, err: e });
    }
  }
  await db.transaction(async (tx) => {
    await releaseCredit(tx, orderId);
  });

  // The buyer may already have paid the kitchen directly.
  let foodDue = 0;
  if (cancelled.sellerId && cancelled.foodPaymentMode === 'upi_now' && ['buyer_claimed', 'confirmed'].includes(cancelled.foodPaymentStatus ?? '')) {
    foodDue = cancelled.foodTotalInPaise;
    await db.insert(kitchenRefundsDue).values({ orderId, sellerId: cancelled.sellerId, amountInPaise: foodDue, reason: opts.reason });
  }

  const feeMsg = refunded ? 'Your platform fee has been refunded automatically.' : 'Your platform fee refund is being processed.';
  const foodMsg = foodDue > 0 ? ` You already paid the kitchen ${formatINR(foodDue)} by UPI — they have been asked to return it, and PadosiPlate will follow up.` : '';
  await notify(cancelled.buyerId, `Order #${orderId} ${opts.reason === 'rejected' ? 'was declined' : 'was not accepted in time'}`, feeMsg + foodMsg, `/orders/${orderId}`);
  if (cancelled.sellerId && opts.reason === 'not_accepted') {
    await notify(cancelled.sellerId, `Order #${orderId} auto-cancelled`, 'You did not accept in time.', '/seller/orders');
  }
  if (foodDue > 0) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
    for (const a of admins) await notify(a.id, `Kitchen refund due — order #${orderId}`, `${formatINR(foodDue)} owed to the buyer.`, '/admin/refunds');
    if (cancelled.sellerId) await notify(cancelled.sellerId, `Please return ${formatINR(foodDue)} to the buyer`, `Order #${orderId} was cancelled after the buyer paid you by UPI. Return it and record the UPI reference.`, '/seller/refunds-due');
  }
  return { status: to, refunded, foodDue };
}

/** Cancels every order that sat unaccepted past its acceptance window. */
export async function autoCancelUnaccepted(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.status, ['fee_paid', 'awaiting_kitchen_payment_confirmation']), eq(orders.type, 'home_delivery'), lt(orders.acceptBy, now)));
  let n = 0;
  for (const { id } of rows) {
    try {
      await cancelOrderWithRefund(id, { actor: 'system', reason: 'not_accepted' });
      n++;
    } catch (e) {
      log.warn('order.auto_cancel_skipped', { orderId: id, err: e });
    }
  }
  return n;
}

/**
 * The buyer said "I've paid" by UPI but the kitchen hasn't confirmed within
 * `kitchenPaymentConfirmMinutes`: notify both sides and the admins ONCE.
 * Never auto-cancels — the kitchen can still confirm; admin can resolve.
 */
export async function remindUnconfirmedPayments(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const cutoff = new Date(now.getTime() - settings.kitchenPaymentConfirmMinutes * 60_000);
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, 'awaiting_kitchen_payment_confirmation'), lt(orders.foodPaymentClaimedAt, cutoff), isNull(orders.kitchenPaymentRemindedAt)));
  let n = 0;
  for (const o of rows) {
    const [won] = await db.update(orders).set({ kitchenPaymentRemindedAt: now }).where(and(eq(orders.id, o.id), isNull(orders.kitchenPaymentRemindedAt))).returning({ id: orders.id });
    if (!won) continue;
    n++;
    await notify(o.buyerId, `Order #${o.id}: waiting for the kitchen to confirm your UPI payment`, 'We have nudged the kitchen. Your order is not cancelled.', `/orders/${o.id}`);
    if (o.sellerId) await notify(o.sellerId, `Please confirm payment for order #${o.id}`, `The buyer says they paid ${formatINR(o.foodTotalInPaise)} by UPI. Tap “Payment received” or “Not received”.`, '/seller/orders');
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
    for (const a of admins) await notify(a.id, `Unconfirmed kitchen payment — order #${o.id}`, 'Buyer claims UPI payment; kitchen has not confirmed.', '/admin/orders');
  }
  return n;
}
