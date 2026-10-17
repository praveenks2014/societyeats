import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { kitchenSubscriptions, orders, payments } from '@/lib/db/schema';
import { markOrderPaid } from './index';
import { fetchRazorpayPayment } from './razorpay';
import { verifyCheckoutSignature } from './signature';
import { markSubscriptionPaid } from '@/lib/subscriptions/service';

export type VerifyInput = {
  userId: number;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  /** Optional client hints — they must agree with what the Razorpay order maps to. */
  orderId?: number;
  subscriptionId?: number;
};

/**
 * Server-side verification of a Razorpay Checkout success callback.
 *  1. the razorpay_order_id must map to a payment we created
 *  2. that payment must belong to the order/subscription the client named AND to the session user
 *  3. HMAC signature (length-guarded constant-time compare)
 *  4. live mode: fetch the payment from Razorpay; status and amount must match what we stored
 * Any mismatch → 400. Only then the exactly-once markPaid runs.
 */
export async function verifyAndMarkPaid(v: VerifyInput): Promise<{ kind: 'order' | 'subscription'; won: boolean }> {
  const bad = (msg = 'Payment verification failed') => new ApiError(400, msg);
  if (!v.razorpay_order_id || !v.razorpay_payment_id || !v.razorpay_signature) throw bad();
  const db = await getDb();

  const [pay] = await db.select().from(payments).where(eq(payments.razorpayOrderId, v.razorpay_order_id));
  const [sub] = pay ? [] : await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.razorpayOrderId, v.razorpay_order_id));
  if (!pay && !sub) throw bad();

  let expectedAmount: number;
  if (pay) {
    const [order] = await db.select().from(orders).where(eq(orders.id, pay.orderId));
    if (!order || order.buyerId !== v.userId) throw bad();
    if (v.orderId !== undefined && v.orderId !== pay.orderId) throw bad();
    if (v.subscriptionId !== undefined) throw bad();
    expectedAmount = pay.amountInPaise;
  } else {
    if (sub!.sellerId !== v.userId) throw bad();
    if (v.subscriptionId !== undefined && v.subscriptionId !== sub!.id) throw bad();
    if (v.orderId !== undefined) throw bad();
    expectedAmount = sub!.pricePaiseSnapshot + sub!.gstPaise;
  }

  if (!verifyCheckoutSignature(v.razorpay_order_id, v.razorpay_payment_id, v.razorpay_signature)) throw bad('Payment signature verification failed');

  if (!isMockMode()) {
    const rp = await fetchRazorpayPayment(v.razorpay_payment_id);
    if (rp.order_id !== v.razorpay_order_id) throw bad();
    if (!['captured', 'authorized'].includes(rp.status)) throw bad('Payment is not captured yet');
    if (rp.amount !== expectedAmount) throw bad('Payment amount does not match');
  }

  if (pay) {
    const r = await markOrderPaid(pay.orderId, { razorpayPaymentId: v.razorpay_payment_id, method: 'razorpay' });
    return { kind: 'order', won: r.won };
  }
  const r = await markSubscriptionPaid(sub!.id, { razorpayPaymentId: v.razorpay_payment_id });
  return { kind: 'subscription', won: r.won };
}
