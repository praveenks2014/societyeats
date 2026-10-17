import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  listings,
  orderEvents,
  orderItems,
  orders,
  payments,
  restaurantItems,
  restaurants,
} from '@/lib/db/schema';
import { isMockMode } from '@/lib/config';
import { notify } from '@/lib/db/notify';

export type CheckoutPayload =
  | { mode: 'mock'; orderId: number; amountInPaise: number }
  | {
      mode: 'razorpay';
      orderId: number;
      amountInPaise: number;
      keyId: string;
      razorpayOrderId: string;
    };

/** Create the payment intent for an order: Razorpay order in live mode, a styled fake sheet in MOCK_MODE. */
export async function createPaymentForOrder(
  orderId: number,
  amountInPaise: number,
): Promise<CheckoutPayload> {
  const db = await getDb();

  if (isMockMode()) {
    await db.insert(payments).values({
      orderId,
      razorpayOrderId: `order_MOCK${orderId}_${Date.now()}`,
      status: 'created',
    });
    return { mode: 'mock', orderId, amountInPaise };
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing with MOCK_MODE=false');
  }
  const { default: Razorpay } = await import('razorpay');
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const rzpOrder = await client.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: `pp_${orderId}`,
  });
  await db.insert(payments).values({
    orderId,
    razorpayOrderId: rzpOrder.id,
    status: 'created',
  });
  return { mode: 'razorpay', orderId, amountInPaise, keyId, razorpayOrderId: rzpOrder.id };
}

/**
 * Idempotent transition to paid: captures the payment row, decrements stock,
 * writes the timeline event and notifies the kitchen/counter. Called from the
 * mock checkout, the client-side Razorpay handler AND the webhook — whichever
 * lands first wins, the rest no-op.
 */
export async function markOrderPaid(
  orderId: number,
  info: { razorpayPaymentId?: string; method?: string; webhookPayload?: unknown },
): Promise<void> {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.status !== 'placed') return; // already paid / cancelled — idempotent

  await db
    .update(payments)
    .set({
      status: 'captured',
      razorpayPaymentId: info.razorpayPaymentId ?? `pay_MOCK${orderId}_${Date.now()}`,
      method: info.method ?? 'upi',
      capturedAt: new Date(),
      ...(info.webhookPayload ? { webhookPayloadJson: info.webhookPayload } : {}),
    })
    .where(eq(payments.orderId, orderId));

  await db.update(orders).set({ status: 'paid', updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, status: 'paid', note: 'Payment captured' });

  // decrement stock
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const item of items) {
    if (item.listingId) {
      const [l] = await db.select().from(listings).where(eq(listings.id, item.listingId));
      if (l) {
        await db
          .update(listings)
          .set({ availableQty: Math.max(0, l.availableQty - item.qty) })
          .where(eq(listings.id, item.listingId));
      }
    }
    if (item.restaurantItemId) {
      const [ri] = await db
        .select()
        .from(restaurantItems)
        .where(eq(restaurantItems.id, item.restaurantItemId));
      if (ri) {
        await db
          .update(restaurantItems)
          .set({ stockQty: Math.max(0, ri.stockQty - item.qty) })
          .where(eq(restaurantItems.id, item.restaurantItemId));
      }
    }
  }

  // notify the vendor
  if (order.sellerId) {
    await notify(
      order.sellerId,
      `New order #${orderId} 🍲`,
      'A buyer just paid. Accept it from your order queue.',
      '/seller/orders',
    );
  }
  if (order.restaurantId) {
    const [rest] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, order.restaurantId));
    if (rest?.managerUserId) {
      await notify(
        rest.managerUserId,
        `New pickup order #${orderId} 🛍️`,
        'A buyer just paid for an order-ahead pickup.',
        '/restaurant',
      );
    }
  }
}

export async function markPaymentFailed(orderId: number): Promise<void> {
  const db = await getDb();
  await db
    .update(payments)
    .set({ status: 'failed' })
    .where(eq(payments.orderId, orderId));
}

/** Razorpay Checkout success-handler signature: HMAC-SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Webhook signature: HMAC-SHA256(raw body, webhook_secret) in X-Razorpay-Signature. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
