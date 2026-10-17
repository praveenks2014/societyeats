import { api, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { verifyAndMarkPaid } from '@/lib/payments/verify';

export const dynamic = 'force-dynamic';

/** Razorpay Checkout success handler → server-side verification (ownership, signature, live amount check). */
export const POST = api(async (req) => {
  const session = await requireSession();
  const body = await readJson<{
    orderId?: number;
    subscriptionId?: number;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }>(req);
  const r = await verifyAndMarkPaid({ userId: session.uid, ...body });
  return ok({ ok: true, kind: r.kind });
});
