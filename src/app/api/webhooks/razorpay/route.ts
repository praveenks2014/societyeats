import { and, eq, inArray, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getDb } from '@/lib/db';
import { plusMemberships, kitchenSubscriptions, orders, payments, refunds, upiVerifications, webhookEvents } from '@/lib/db/schema';
import { paymentsMode } from '@/lib/payments/mode';
import { log } from '@/lib/log';
import { ensureCaptured } from '@/lib/payments/capture';
import { markOrderPaid, verifyWebhookSignature } from '@/lib/payments';
import { markSubscriptionPaid } from '@/lib/subscriptions/service';
import { completeRpdValidation, finalizeVerification, VERIFY_AMOUNT_PAISE } from '@/lib/upi-verify';
import { fetchRazorpayPayment } from '@/lib/payments/razorpay';
import { parseValidation } from '@/lib/upi-verify/razorpayx';

export const dynamic = 'force-dynamic';

type Entity = { id?: string; order_id?: string; method?: string; amount?: number; payment_id?: string; status?: string; notes?: Record<string, unknown> | unknown[] };
type Payload = {
  event?: string;
  payload?: { payment?: { entity?: Entity }; order?: { entity?: Entity }; refund?: { entity?: Entity }; fund_account_validation?: { entity?: Record<string, unknown> } };
};

/**
 * Razorpay webhook (Dashboard → Webhooks):
 *   URL:    https://<site>/api/webhooks/razorpay        Secret: RAZORPAY_WEBHOOK_SECRET
 *   Events: payment.authorized, payment.captured, payment.failed, refund.processed, refund.failed,
 *           fund_account.validation.completed, fund_account.validation.failed (RazorpayX only)
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
    if (!entity?.order_id) return 'ignored_foreign'; // a payment with no order cannot be ours: we always create an order first
    // The Razorpay account may be shared: an order tagged for another app is none of our business.
    const tag = (entity.notes && !Array.isArray(entity.notes) ? entity.notes.app : undefined) ?? (payload.payload?.order?.entity?.notes && !Array.isArray(payload.payload.order.entity.notes) ? payload.payload.order.entity.notes.app : undefined);
    if (tag !== undefined && tag !== 'padosiplate') return 'ignored_foreign';
    const [pay] = await db.select().from(payments).where(eq(payments.razorpayOrderId, entity.order_id));
    const [sub] = pay ? [] : await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.razorpayOrderId, entity.order_id));
    if (!pay && !sub) {
      // A PadosiPlate Plus month (flag-off feature): same rules, so a buyer who pays and closes the tab still gets the membership.
      const [plus] = await db.select().from(plusMemberships).where(eq(plusMemberships.razorpayOrderId, entity.order_id));
      if (plus) {
        if (event === 'payment.failed') return 'plus_failed_recorded';
        const want = plus.pricePaise + plus.gstPaise;
        if (entity.amount !== want || !entity.id) return 'amount_mismatch';
        if (paymentsMode() !== 'mock') await ensureCaptured({ paymentId: entity.id, razorpayOrderId: entity.order_id, amountInPaise: want });
        const { activatePurchase } = await import('@/lib/plus');
        return (await activatePurchase(plus.id, entity.id)) ? 'plus_activated' : 'plus_already_active';
      }
      // A ₹1 UPI-ownership check for a kitchen (razorpay_checkout_vpa provider).
      const [ver] = await db.select().from(upiVerifications).where(eq(upiVerifications.razorpayOrderId, entity.order_id));
      if (ver && event !== 'payment.failed') {
        if (entity.amount !== VERIFY_AMOUNT_PAISE || !entity.id) return 'amount_mismatch';
        if (paymentsMode() !== 'mock') await ensureCaptured({ paymentId: entity.id, razorpayOrderId: entity.order_id, amountInPaise: VERIFY_AMOUNT_PAISE });
        const full = paymentsMode() === 'mock' ? null : await fetchRazorpayPayment(entity.id);
        await finalizeVerification(ver.id, { verifiedVpa: full?.vpa ?? full?.upi?.vpa ?? null, paymentId: entity.id });
        return 'upi_verification_recorded';
      }
      return ver ? 'upi_verification_failed' : 'ignored_foreign';
    }

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
    if (paymentsMode() !== 'mock') await ensureCaptured({ paymentId: entity.id, razorpayOrderId: entity.order_id, amountInPaise: expected });
    if (pay) {
      const r = await markOrderPaid(pay.orderId, { razorpayPaymentId: entity.id, method: entity.method ?? 'razorpay', webhookPayload: payload });
      return r.won ? 'order_paid' : 'order_already_paid';
    }
    const r = await markSubscriptionPaid(sub!.id, { razorpayPaymentId: entity.id });
    return r.won ? 'subscription_paid' : 'subscription_already_paid';
  }

  if (event === 'fund_account.validation.completed' || event === 'fund_account.validation.failed') {
    const entity = payload.payload?.fund_account_validation?.entity;
    if (!entity?.id) return 'no_validation';
    const v = parseValidation(entity as Record<string, any>);
    await completeRpdValidation({ ...v, status: event.endsWith('failed') ? 'failed' : 'completed' });
    return 'upi_validation_recorded';
  }

  if (event === 'refund.processed' || event === 'refund.failed') {
    const entity = payload.payload?.refund?.entity;
    if (!entity?.id) return 'no_refund';
    const [row] = await db.select().from(refunds).where(eq(refunds.razorpayRefundId, entity.id));
    if (!row) return 'ignored_foreign'; // a refund we did not issue (another app on the same account)
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
