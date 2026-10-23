import { and, eq, sql } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { kitchenSubscriptions, orders, payments, refunds } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { formatINR } from '@/lib/money';
import { createRazorpayRefund } from './razorpay';

/**
 * ONE service for every Razorpay refund the platform issues — and only of the
 * platform's own money (the buyer platform fee / a subscription). The
 * refundable amount is reserved atomically BEFORE calling Razorpay, so two
 * concurrent callers can never refund more than was captured; if Razorpay
 * fails the reservation is rolled back and the refund row marked failed.
 */
export type RefundResult = { refundId: number; amountInPaise: number; status: 'processed' | 'pending' };

export async function refundOrderPayment(opts: {
  orderId: number;
  amountInPaise?: number;
  reason: string;
  initiatedBy: string; // 'system' | `admin:${id}`
}): Promise<RefundResult> {
  const db = await getDb();
  const [pay] = await db.select().from(payments).where(eq(payments.orderId, opts.orderId));
  if (!pay || !pay.razorpayPaymentId || !['captured', 'refunded'].includes(pay.status)) {
    throw new ApiError(409, 'There is no captured platform payment to refund on this order');
  }
  const refundable = pay.amountInPaise - pay.refundedInPaise;
  const amount = opts.amountInPaise ?? refundable;
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError(400, 'Enter a valid refund amount');
  if (amount > refundable) throw new ApiError(409, `Only ${formatINR(refundable)} can still be refunded on this order`);

  // Reserve first (atomic), then call the gateway.
  const [reserved] = await db
    .update(payments)
    .set({ refundedInPaise: sql`${payments.refundedInPaise} + ${amount}` })
    .where(and(eq(payments.id, pay.id), sql`${payments.refundedInPaise} + ${amount} <= ${payments.amountInPaise}`))
    .returning();
  if (!reserved) throw new ApiError(409, 'That refund is no longer available');

  const [row] = await db
    .insert(refunds)
    .values({ kind: pay.kind === 'order_full' ? 'order_full' : 'platform_fee', orderId: opts.orderId, razorpayPaymentId: pay.razorpayPaymentId, amountInPaise: amount, reason: opts.reason, initiatedBy: opts.initiatedBy })
    .returning();

  try {
    const r = await createRazorpayRefund({ paymentId: pay.razorpayPaymentId, amountInPaise: amount, notes: { orderId: String(opts.orderId), reason: opts.reason.slice(0, 100) } });
    await db.update(refunds).set({ razorpayRefundId: r.id, status: r.status, processedAt: r.status === 'processed' ? new Date() : null }).where(eq(refunds.id, row.id));
    await db
      .update(payments)
      .set({ status: reserved.refundedInPaise >= reserved.amountInPaise ? 'refunded' : 'captured' })
      .where(eq(payments.id, pay.id));
    await db.update(orders).set({ refundInPaise: sql`${orders.refundInPaise} + ${amount}` }).where(eq(orders.id, opts.orderId));
    const [o] = await db.select({ buyerId: orders.buyerId }).from(orders).where(eq(orders.id, opts.orderId));
    if (o) await notify(o.buyerId, `Platform fee refunded for order #${opts.orderId} 💸`, `${formatINR(amount)} is on its way back to your original payment method.`, `/orders/${opts.orderId}`);
    return { refundId: row.id, amountInPaise: amount, status: r.status };
  } catch (e) {
    log.error('refund.failed', { orderId: opts.orderId, err: e });
    await db.update(payments).set({ refundedInPaise: sql`${payments.refundedInPaise} - ${amount}` }).where(eq(payments.id, pay.id));
    await db.update(refunds).set({ status: 'failed', error: String((e as Error).message).slice(0, 300) }).where(eq(refunds.id, row.id));
    throw new ApiError(502, 'The payment gateway rejected the refund — try again or refund from the Razorpay dashboard');
  }
}

/** Admin-only, manual: refund (part of) a kitchen subscription payment. */
export async function refundSubscriptionPayment(opts: { subscriptionId: number; amountInPaise?: number; reason: string; adminId: number }): Promise<RefundResult> {
  const db = await getDb();
  const [sub] = await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.id, opts.subscriptionId));
  if (!sub || !sub.razorpayPaymentId || !sub.paidAt) throw new ApiError(409, 'This subscription has no Razorpay payment to refund');
  const total = sub.pricePaiseSnapshot + sub.gstPaise;
  const refundable = total - sub.refundedPaise;
  const amount = opts.amountInPaise ?? refundable;
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError(400, 'Enter a valid refund amount');
  if (amount > refundable) throw new ApiError(409, `Only ${formatINR(refundable)} can still be refunded`);
  const [reserved] = await db
    .update(kitchenSubscriptions)
    .set({ refundedPaise: sql`${kitchenSubscriptions.refundedPaise} + ${amount}` })
    .where(and(eq(kitchenSubscriptions.id, sub.id), sql`${kitchenSubscriptions.refundedPaise} + ${amount} <= ${total}`))
    .returning();
  if (!reserved) throw new ApiError(409, 'That refund is no longer available');
  const [row] = await db.insert(refunds).values({ kind: 'subscription', subscriptionId: sub.id, razorpayPaymentId: sub.razorpayPaymentId, amountInPaise: amount, reason: opts.reason, initiatedBy: `admin:${opts.adminId}` }).returning();
  try {
    const r = await createRazorpayRefund({ paymentId: sub.razorpayPaymentId, amountInPaise: amount, notes: { subscriptionId: String(sub.id) } });
    await db.update(refunds).set({ razorpayRefundId: r.id, status: r.status, processedAt: r.status === 'processed' ? new Date() : null }).where(eq(refunds.id, row.id));
    await notify(sub.sellerId, 'Subscription refund issued', `${formatINR(amount)} is on its way back to you.`, '/seller/subscription');
    return { refundId: row.id, amountInPaise: amount, status: r.status };
  } catch (e) {
    await db.update(kitchenSubscriptions).set({ refundedPaise: sql`${kitchenSubscriptions.refundedPaise} - ${amount}` }).where(eq(kitchenSubscriptions.id, sub.id));
    await db.update(refunds).set({ status: 'failed', error: String((e as Error).message).slice(0, 300) }).where(eq(refunds.id, row.id));
    throw new ApiError(502, 'The payment gateway rejected the refund');
  }
}
