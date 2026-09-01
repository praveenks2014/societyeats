import { and, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { complaints, orders, payments, sellerProfiles } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';
import { COMPLAINT_OUTCOME_LABELS, isUpheldOutcome, type ComplaintOutcome } from '@/lib/complaints';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

const OUTCOMES: ComplaintOutcome[] = ['full_refund', 'partial_refund', 'warning', 'seller_paused', 'rejected'];

type Body = { outcome: ComplaintOutcome; refundInPaise?: number; note?: string };

/**
 * Admin resolves a complaint with exactly one outcome (DECISIONS.md #73+).
 * Refunds are recorded on the order/payment immediately (so the buyer sees it
 * right away) but deducted from the seller's payout only when the next T+2
 * batch runs (src/lib/payouts.ts) — orders.updatedAt is deliberately left
 * untouched here so a refund never re-extends that order's 48h payout hold.
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
  const remaining = order.totalInPaise - order.refundInPaise;

  let refundAmount = 0;
  if (body.outcome === 'full_refund') {
    if (remaining <= 0) throw new ApiError(409, 'This order has already been fully refunded');
    refundAmount = remaining;
  } else if (body.outcome === 'partial_refund') {
    const amt = Math.round(Number(body.refundInPaise));
    if (!Number.isFinite(amt) || amt <= 0) throw new ApiError(400, 'Enter a valid partial refund amount');
    if (amt > remaining) throw new ApiError(400, `Cannot refund more than the remaining ${remaining} paise on this order`);
    refundAmount = amt;
  }

  const now = new Date();
  await db
    .update(complaints)
    .set({
      status: 'resolved',
      outcome: body.outcome,
      refundInPaise: refundAmount,
      resolutionNote: body.note?.trim() || null,
      resolvedByAdminId: session.uid,
      resolvedAt: now,
    })
    .where(eq(complaints.id, id));

  if (refundAmount > 0) {
    const newOrderRefund = order.refundInPaise + refundAmount;
    // orders.updatedAt intentionally NOT touched — see function doc comment.
    await db.update(orders).set({ refundInPaise: newOrderRefund }).where(eq(orders.id, order.id));

    const [payment] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    if (payment) {
      const newPaymentRefund = payment.refundedInPaise + refundAmount;
      await db
        .update(payments)
        .set({
          refundedInPaise: newPaymentRefund,
          status: newPaymentRefund >= order.totalInPaise ? 'refunded' : payment.status,
        })
        .where(eq(payments.orderId, order.id));
    }

    await notify(
      order.buyerId,
      `Refund issued for order #${order.id} 💸`,
      `₹${(refundAmount / 100).toFixed(2)} will be credited back to your original payment method.`,
      `/orders/${order.id}`,
    );
  }

  if (body.outcome === 'seller_paused' && order.sellerId) {
    await db.update(sellerProfiles).set({ isApproved: false }).where(eq(sellerProfiles.userId, order.sellerId));
    await notify(order.sellerId, 'Your kitchen has been paused', 'A complaint review resulted in your kitchen being paused. Contact support.', '/seller/compliance');
  } else if (body.outcome === 'warning' && order.sellerId) {
    await notify(
      order.sellerId,
      'Warning: complaint upheld ⚠️',
      `A buyer complaint about order #${order.id} was upheld. Repeated hygiene complaints can pause your kitchen.`,
      '/seller/orders',
    );
  }

  // Three UPHELD hygiene complaints auto-pause the seller (founder-specified
  // trust rule) — checked after every resolution, not just 'seller_paused'
  // outcomes, since a string of full-refund hygiene complaints should trip
  // it too.
  if (complaint.category === 'hygiene' && isUpheldOutcome(body.outcome) && order.sellerId) {
    const resolved = await db
      .select({ id: complaints.id, outcome: complaints.outcome })
      .from(complaints)
      .where(and(eq(complaints.sellerId, order.sellerId), eq(complaints.category, 'hygiene'), eq(complaints.status, 'resolved')));
    const upheldCount = resolved.filter((r) => isUpheldOutcome(r.outcome as ComplaintOutcome | null)).length;
    if (upheldCount >= DEFAULTS.hygieneAutoPauseThreshold) {
      const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, order.sellerId));
      if (profile?.isApproved) {
        await db.update(sellerProfiles).set({ isApproved: false }).where(eq(sellerProfiles.userId, order.sellerId));
        await notify(
          order.sellerId,
          'Kitchen auto-paused — repeated hygiene complaints',
          `${upheldCount} hygiene complaints have been upheld against your kitchen. It has been automatically paused pending review.`,
          '/seller/compliance',
        );
      }
    }
  }

  const [updated] = await db.select().from(complaints).where(eq(complaints.id, id));
  return ok({ complaint: updated, outcomeLabel: COMPLAINT_OUTCOME_LABELS[body.outcome] });
});
