import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { payments } from '@/lib/db/schema';
import { markOrderPaid, verifyWebhookSignature } from '@/lib/payments';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook (configure in the Razorpay dashboard → Webhooks):
 *   URL:    https://<your-app>/api/webhooks/razorpay
 *   Secret: RAZORPAY_WEBHOOK_SECRET
 *   Events: payment.captured, payment.failed
 * Signature is HMAC-SHA256 of the raw body; the paid transition is idempotent,
 * so the webhook and the client-side verify handler can race safely.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let payload: {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; method?: string } } };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const entity = payload.payload?.payment?.entity;
  if (!entity?.order_id) return NextResponse.json({ ok: true, skipped: true });

  const db = await getDb();
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, entity.order_id));
  if (!payment) return NextResponse.json({ ok: true, skipped: true });

  if (payload.event === 'payment.captured') {
    await markOrderPaid(payment.orderId, {
      razorpayPaymentId: entity.id,
      method: entity.method ?? 'razorpay',
      webhookPayload: payload,
    });
  } else if (payload.event === 'payment.failed') {
    await db
      .update(payments)
      .set({ status: 'failed', webhookPayloadJson: payload })
      .where(eq(payments.id, payment.id));
  }

  return NextResponse.json({ ok: true });
}
