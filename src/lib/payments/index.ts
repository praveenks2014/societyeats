import { and, eq, inArray, sql } from 'drizzle-orm';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { orderEvents, orders, payments, restaurantItems, restaurants, orderItems } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { consumeReservedCredit } from '@/lib/referrals';
import { createRazorpayOrder, receiptFor } from './razorpay';

export { verifyCheckoutSignature, verifyWebhookSignature } from './signature';

/**
 * Payments in this app are ONLY the platform's own revenue:
 *   - the buyer platform fee on a home-food order (payments.kind='order_fee')
 *   - kitchen subscriptions (kitchen_subscriptions table, see subscriptions/service.ts)
 * plus the legacy full-amount Mall order (flag off). Food money for home
 * orders never touches Razorpay.
 */
export type CheckoutPayload =
  | { mode: 'none'; orderId: number; amountInPaise: 0 }
  | { mode: 'mock'; orderId: number; amountInPaise: number }
  | { mode: 'razorpay'; orderId: number; amountInPaise: number; keyId: string; razorpayOrderId: string };

/** Creates the Razorpay order (or the mock sheet) for what the platform collects on this order. */
export async function createOrderPayment(orderId: number, amountInPaise: number, kind: 'order_fee' | 'order_full' = 'order_fee'): Promise<CheckoutPayload> {
  const db = await getDb();
  const rzp = await createRazorpayOrder({ amountInPaise, receipt: receiptFor('o', orderId), notes: { orderId: String(orderId), kind } });
  await db.insert(payments).values({ orderId, razorpayOrderId: rzp.id, status: 'created', amountInPaise, kind });
  if (isMockMode() || !rzp.keyId) return { mode: 'mock', orderId, amountInPaise };
  return { mode: 'razorpay', orderId, amountInPaise, keyId: rzp.keyId, razorpayOrderId: rzp.id };
}

/** Back-compat name used by the Mall path. */
export async function createPaymentForOrder(orderId: number, amountInPaise: number): Promise<CheckoutPayload> {
  return createOrderPayment(orderId, amountInPaise, 'order_full');
}

export type PaidResult = { won: boolean; status?: string };

/**
 * Exactly-once transition placed → fee_paid (home) / paid (mall). The
 * conditional UPDATE … WHERE status='placed' RETURNING inside a transaction
 * means that if verify, the webhook and the mock sheet race, exactly one
 * caller wins; only the winner runs side effects (notifications, credit
 * consumption). A capture that arrives for an order that already expired or
 * was cancelled is recorded and automatically refunded.
 */
export async function markOrderPaid(
  orderId: number,
  info: { razorpayPaymentId?: string; method?: string; webhookPayload?: unknown } = {},
): Promise<PaidResult> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const now = new Date();
  const paymentId = info.razorpayPaymentId ?? `pay_MOCK${orderId}_${now.getTime().toString(36)}`;

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!existing) return { won: false as const, order: null };
    const home = existing.type === 'home_delivery';
    const to = home ? 'fee_paid' : 'paid';
    const [order] = await tx
      .update(orders)
      .set({
        status: to,
        feePaidAt: now,
        expiresAt: null,
        acceptBy: home ? new Date(now.getTime() + settings.sellerAcceptWindowMinutes * 60_000) : null,
        updatedAt: now,
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'placed')))
      .returning();
    if (!order) return { won: false as const, order: existing };

    await tx
      .update(payments)
      .set({
        status: 'captured',
        razorpayPaymentId: paymentId,
        method: info.method ?? 'upi',
        capturedAt: now,
        ...(info.webhookPayload ? { webhookPayloadJson: info.webhookPayload } : {}),
      })
      .where(eq(payments.orderId, orderId));
    await tx.insert(orderEvents).values({ orderId, status: to, note: home ? 'Platform fee paid — sent to the kitchen' : 'Payment captured' });
    await consumeReservedCredit(tx, orderId);

    // Mall (legacy) stock is decremented after payment; home stock was reserved at creation.
    if (!home) {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      for (const it of items) {
        if (it.restaurantItemId) {
          await tx
            .update(restaurantItems)
            .set({ stockQty: sql`greatest(${restaurantItems.stockQty} - ${it.qty}, 0)` })
            .where(eq(restaurantItems.id, it.restaurantItemId));
        }
      }
    }
    return { won: true as const, order };
  });

  if (!result.won) {
    // Late capture on an order that is already dead → refund it automatically.
    if (result.order && ['expired', 'cancelled'].includes(result.order.status)) {
      await handleLateCapture(orderId, paymentId, info.method);
    }
    return { won: false, status: result.order?.status };
  }

  const order = result.order!;
  if (order.sellerId) {
    await notify(order.sellerId, `New order #${orderId} 🍲`, 'A neighbour just placed an order. Accept it from your order queue.', '/seller/orders');
  }
  if (order.restaurantId) {
    const [rest] = await db.select().from(restaurants).where(eq(restaurants.id, order.restaurantId));
    if (rest?.managerUserId) await notify(rest.managerUserId, `New pickup order #${orderId} 🛍️`, 'A buyer just paid for an order-ahead pickup.', '/restaurant');
  }
  return { won: true, status: order.status };
}

async function handleLateCapture(orderId: number, paymentId: string, method?: string) {
  const db = await getDb();
  const [pay] = await db.select().from(payments).where(eq(payments.orderId, orderId));
  if (!pay || pay.status === 'captured' || pay.status === 'refunded') return;
  await db.update(payments).set({ status: 'captured', razorpayPaymentId: pay.razorpayPaymentId ?? paymentId, method: method ?? 'upi', capturedAt: new Date() }).where(eq(payments.id, pay.id));
  try {
    const { refundOrderPayment } = await import('./refunds');
    await refundOrderPayment({ orderId, reason: 'Payment arrived after the order had expired or been cancelled', initiatedBy: 'system' });
  } catch (e) {
    log.error('payments.late_capture_refund_failed', { orderId, err: e });
  }
}

/** A failed attempt never downgrades a captured/refunded payment; the order stays 'placed' so the buyer can retry until it expires. */
export async function markPaymentFailed(orderId: number): Promise<void> {
  const db = await getDb();
  await db.update(payments).set({ status: 'failed' }).where(and(eq(payments.orderId, orderId), inArray(payments.status, ['created', 'authorized'])));
}
