import { and, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { DEFAULTS } from '@/lib/config';
import { COMPLAINT_OUTCOME_LABELS, isUpheldOutcome, type ComplaintOutcome } from '@/lib/complaints';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { complaints, kitchenRefundsDue, orders, payments, sellerProfiles } from '@/lib/db/schema';
import { transitionKitchen } from '@/lib/kitchen/state';
import { formatINR } from '@/lib/money';
import { refundOrderPayment } from '@/lib/payments/refunds';

export const dynamic = 'force-dynamic';

const OUTCOMES: ComplaintOutcome[] = ['full_refund', 'partial_refund', 'warning', 'seller_paused', 'rejected'];

type Body = {
  outcome: ComplaintOutcome;
  /** Partial refund only: platform-fee refund (Razorpay) in paise. */
  platformFeeRefundInPaise?: number;
  /** Partial refund only: food refund the KITCHEN owes the buyer, in paise. */
  foodRefundDueInPaise?: number;
  note?: string;
};

/**
 * Admin resolves a complaint with exactly one outcome. Refunds are split by
 * who holds the money:
 *   - the PLATFORM FEE is refunded by the platform through Razorpay (full or partial);
 *   - the FOOD amount was paid straight to the kitchen, so the kitchen owes it —
 *     tracked as a "kitchen refund due" item that the kitchen marks refunded with a
 *     UPI reference and that admin can see and chase.
 */
export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['admin']);
  const body = await readJson<Body>(req);
  const id = Number(params.id);
  if (!OUTCOMES.includes(body.outcome)) throw new ApiError(400, 'Invalid outcome');

  const db = await getDb();
  const [complaint] = await db.select().from(complaints).where(eq(complaints.id, id));
  if (!complaint) throw new ApiError(404, 'Complaint not found');
  if (complaint.status === 'resolved') throw new ApiError(409, 'This complaint is already resolved');
  const [order] = await db.select().from(orders).where(eq(orders.id, complaint.orderId));
  if (!order) throw new ApiError(404, 'Order not found');
  const [pay] = await db.select().from(payments).where(eq(payments.orderId, order.id));
  const feeRemaining = pay && ['captured', 'refunded'].includes(pay.status) ? pay.amountInPaise - pay.refundedInPaise : 0;
  const foodPaid = order.type === 'home_delivery' && ['confirmed', 'at_handover'].includes(order.foodPaymentStatus ?? '');

  let feeRefund = 0;
  let foodDue = 0;
  if (body.outcome === 'full_refund') {
    feeRefund = feeRemaining;
    foodDue = foodPaid ? order.foodTotalInPaise : 0;
    if (feeRefund === 0 && foodDue === 0) throw new ApiError(409, 'There is nothing left to refund on this order');
  } else if (body.outcome === 'partial_refund') {
    feeRefund = Math.trunc(Number(body.platformFeeRefundInPaise ?? 0));
    foodDue = Math.trunc(Number(body.foodRefundDueInPaise ?? 0));
    if (!Number.isFinite(feeRefund) || !Number.isFinite(foodDue) || feeRefund < 0 || foodDue < 0 || feeRefund + foodDue <= 0) {
      throw new ApiError(400, 'Enter a platform-fee refund, a kitchen food refund, or both');
    }
    if (feeRefund > feeRemaining) throw new ApiError(400, `At most ${formatINR(feeRemaining)} of the platform fee can still be refunded`);
    if (foodDue > order.foodTotalInPaise) throw new ApiError(400, `The food total was only ${formatINR(order.foodTotalInPaise)}`);
  }

  // Money first: if Razorpay refuses, nothing is recorded as resolved.
  if (feeRefund > 0) {
    await refundOrderPayment({ orderId: order.id, amountInPaise: feeRefund, reason: `Complaint #${id} upheld`, initiatedBy: `admin:${session.uid}` });
  }
  await db
    .update(complaints)
    .set({
      status: 'resolved',
      outcome: body.outcome,
      refundInPaise: feeRefund + foodDue,
      platformFeeRefundInPaise: feeRefund,
      foodRefundDueInPaise: foodDue,
      resolutionNote: body.note?.trim() || null,
      resolvedByAdminId: session.uid,
      resolvedAt: new Date(),
    })
    .where(eq(complaints.id, id));

  if (foodDue > 0 && order.sellerId) {
    await db.insert(kitchenRefundsDue).values({ orderId: order.id, sellerId: order.sellerId, amountInPaise: foodDue, reason: 'complaint' });
    await notify(order.sellerId, `Please refund ${formatINR(foodDue)} to the buyer`, `A complaint on order #${order.id} was upheld. Return the food amount by UPI and record the reference.`, '/seller/refunds-due');
    await notify(order.buyerId, `Complaint upheld — ${formatINR(foodDue)} due from the kitchen`, 'The kitchen has been asked to return the food amount you paid them. PadosiPlate will follow up.', `/orders/${order.id}`);
  }

  if (body.outcome === 'seller_paused' && order.sellerId) {
    const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, order.sellerId));
    if (p?.listingState === 'approved') await transitionKitchen(order.sellerId, 'delist', { id: session.uid, role: 'admin' }, { category: 'complaints', reason: `Paused after complaint #${id}` });
  } else if (body.outcome === 'warning' && order.sellerId) {
    await notify(order.sellerId, 'Warning: complaint upheld ⚠️', `A buyer complaint about order #${order.id} was upheld. Repeated hygiene complaints can pause your kitchen.`, '/seller/orders');
  }

  // Three UPHELD hygiene complaints auto-delist the kitchen.
  if (complaint.category === 'hygiene' && isUpheldOutcome(body.outcome) && order.sellerId) {
    const resolved = await db
      .select({ outcome: complaints.outcome })
      .from(complaints)
      .where(and(eq(complaints.sellerId, order.sellerId), eq(complaints.category, 'hygiene'), eq(complaints.status, 'resolved')));
    const upheld = resolved.filter((r) => isUpheldOutcome(r.outcome as ComplaintOutcome | null)).length;
    if (upheld >= DEFAULTS.hygieneAutoPauseThreshold) {
      const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, order.sellerId));
      if (p?.listingState === 'approved') {
        await transitionKitchen(order.sellerId, 'delist', { id: session.uid, role: 'admin' }, { category: 'hygiene', reason: `${upheld} hygiene complaints upheld — automatically paused pending review` });
      }
    }
  }

  const [updated] = await db.select().from(complaints).where(eq(complaints.id, id));
  return ok({ complaint: updated, outcomeLabel: COMPLAINT_OUTCOME_LABELS[body.outcome] });
});
