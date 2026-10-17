import crypto from 'node:crypto';

/** Constant-time compare that is safe for unequal lengths (returns false instead of throwing). */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Razorpay Checkout success-handler signature: HMAC-SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string, secret = process.env.RAZORPAY_KEY_SECRET): boolean {
  if (!secret || !razorpayOrderId || !razorpayPaymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC-SHA256(raw body, webhook_secret) in X-Razorpay-Signature. */
export function verifyWebhookSignature(rawBody: string, signature: string, secret = process.env.RAZORPAY_WEBHOOK_SECRET): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
