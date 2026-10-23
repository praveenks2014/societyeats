import { and, eq, inArray, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getDb } from '@/lib/db';
import { kitchenSubscriptions, orders, payments, refunds, webhookEvents } from '@/lib/db/schema';
import { isMockMode } from '@/lib/config';
import { log } from '@/lib/log';
import { ensureCaptured } from '@/lib/payments/capture';
import { markOrderPaid, verifyWebhookSignature } from '@/lib/payments';
import { markSubscriptionPaid } from '@/lib/subscriptions/service';

export const dynamic = 'force-dynamic';

type Entity = { id?: string; order_id?: string; method?: string; amount?: number; payment_id?: string; status?: string };
type Payload = {
  event?: string;
  payload?: { payment?: { entity?: Entity }; refund?: { entity?: Entity } };
};

/**
 * Razorpay webhook (Dashboard → Webhooks):
 *   URL:    https://<site>/api/webhooks/razorpay        Secret: RAZORPAY_WEBHOOK_SECRET
 *   Events: payment.authorized, payment.captured, payment.failed, refund.processed, refund.failed
 *
 *  - raw-body HMAC check
 *  - deduplicated on the event id (webhook_events)
 *  - a captured payment is never downgraded by a late payment.failed
 *  - the captured amount must equal the amount we asked Razorpay to collect
 *  - handles BOTH order platform-fee payments and kitchen subscriptions
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  let payload: Payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const event = payload.event ?? 'unknown';
  const eventId = req.headers.get('x-razorpay-event-id') || `sha:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;

  const db = await getDb();
  const [fresh] = await db.insert(webhookEvents).values({ id: eventId, type: event }).onConflictDoNothing().returning();
  if (!fresh) return NextResponse.json({ ok: true, duplicate: true });

  let outcome = 'ignored';
  try {
    outcome = await handle(event, payload);
  } catch (e) {
    log.error('webhook.handler_failed', { event, err: e });
    // Let Razorpay retry: forget the dedupe row so the retry is processed.
    await db.delete(webhookEvents).where(eq(webhookEvents.id, eventId));
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
  await db.update(webhookEvents).set({ outcome }).where(eq(webhookEvents.id, eventId));
  return NextResponse.json({ ok: true, outcome });
}

async function handle(event: string, payload: Payload): Promise<string> {
  const db = await getDb();

  if (event === 'payment.authorized' || event === 'payment.captured' || event === 'payment.failed') {
    const entity = payload.payload?.payment?.entity;
    if (!entity?.order_id) return 'no_order';
    const [pay] = await db.select().from(payments).where(eq(payments.razorpayOrderId, entity.order_id));
    const [sub] = pay ? [] : await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.razorpayOrderId, entity.order_id));
    if (!pay && !sub) return 'unknown_order';

    if (event === 'payment.failed') {
      // Never downgrade a payment that was already captured/refunded.
      if (pay) await db.update(payments).set({ status: 'failed', webhookPayloadJson: payload }).where(and(eq(payments.id, pay.id), inArray(payments.status, ['created', 'authorized'])));
      return 'failed_recorded';
    }

    const expected = pay ? pay.amountInPaise : sub!.pricePaiseSnapshot + sub!.gstPaise;
    if (typeof entity.amount !== 'number' || entity.amount !== expected) {
      log.error('webhook.amount_mismatch', { event, expected, got: entity.amount });
      return 'amount_mismatch';
    }
    if (!entity.id) return 'no_payment_id';
    // Live: never trust the payload's status — re-fetch, capture an `authorized` payment, and require `captured`.
    // A failure throws → 500 → Razorpay retries, and the order/subscription stays unpaid meanwhile.
    if (!isMockMode()) await ensureCaptured({ paymentId: entity.id, razorpayOrderId: entity.order_id, amountInPaise: expected });
    if (pay) {
      const r = await markOrderPaid(pay.orderId, { razorpayPaymentId: entity.id, method: entity.method ?? 'razorpay', webhookPayload: payload });
      return r.won ? 'order_paid' : 'order_already_paid';
    }
    const r = await markSubscriptionPaid(sub!.id, { razorpayPaymentId: entity.id });
    return r.won ? 'subscription_paid' : 'subscription_already_paid';
  }

  if (event === 'refund.processed' || event === 'refund.failed') {
    const entity = payload.payload?.refund?.entity;
    if (!entity?.id) return 'no_refund';
    const [row] = await db.select().from(refunds).where(eq(refunds.razorpayRefundId, entity.id));
    if (!row) return 'unknown_refund';
    if (event === 'refund.processed') {
      await db.update(refunds).set({ status: 'processed', processedAt: new Date() }).where(eq(refunds.id, row.id));
      return 'refund_processed';
    }
    // The gateway failed it after accepting: hand the refundable amount back so it can be retried.
    if (row.status !== 'failed') {
      await db.update(refunds).set({ status: 'failed', error: 'Reported failed by Razorpay' }).where(eq(refunds.id, row.id));
      if (row.orderId) {
        await db.update(payments).set({ refundedInPaise: sql`greatest(${payments.refundedInPaise} - ${row.amountInPaise}, 0)`, status: 'captured' }).where(eq(payments.orderId, row.orderId));
        await db.update(orders).set({ refundInPaise: sql`greatest(${orders.refundInPaise} - ${row.amountInPaise}, 0)` }).where(eq(orders.id, row.orderId));
      }
      if (row.subscriptionId) {
        await db.update(kitchenSubscriptions).set({ refundedPaise: sql`greatest(${kitchenSubscriptions.refundedPaise} - ${row.amountInPaise}, 0)` }).where(eq(kitchenSubscriptions.id, row.subscriptionId));
      }
    }
    return 'refund_failed_recorded';
  }

  return 'ignored';
}
