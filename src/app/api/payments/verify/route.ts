import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { markOrderPaid, verifyCheckoutSignature } from '@/lib/payments';

export const dynamic = 'force-dynamic';

/** Razorpay Checkout success handler → server-side signature verification. */
export const POST = api(async (req) => {
  await requireSession();
  const body = await readJson<{
    orderId: number;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }>(req);
  if (
    !verifyCheckoutSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)
  ) {
    throw new ApiError(400, 'Payment signature verification failed');
  }
  await markOrderPaid(body.orderId, {
    razorpayPaymentId: body.razorpay_payment_id,
    method: 'razorpay',
  });
  return ok({ ok: true });
});
