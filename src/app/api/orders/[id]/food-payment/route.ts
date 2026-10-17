import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { complaints, orderEvents, orders, users } from '@/lib/db/schema';
import { formatINR } from '@/lib/money';
import { nextOrderStatus } from '@/lib/orders/state';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum(['claim', 'confirm', 'not_received', 'paid_at_handover']),
  utr: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/, 'UTR should be 6–30 letters/digits').optional().or(z.literal('')),
});

/**
 * The FOOD payment is between buyer and kitchen (UPI or at pickup); the
 * platform only records the steps so both sides and admin can see them.
 *   buyer  claim            "I've paid" (+ optional UTR)  → awaiting kitchen confirmation
 *   kitchen confirm         "Payment received"
 *   kitchen not_received    "Not received" → opens a complaint for admin
 *   kitchen paid_at_handover  pay-at-pickup orders, before the OTP
 */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const { action, utr } = parsed.data;
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.type !== 'home_delivery') throw new ApiError(404, 'Order not found');

  const isBuyer = order.buyerId === session.uid;
  const isKitchen = order.sellerId === session.uid || session.role === 'admin';
  const now = new Date();

  if (action === 'claim') {
    if (!isBuyer) throw new ApiError(403, 'Only the buyer can do that');
    if (order.foodPaymentMode !== 'upi_now') throw new ApiError(409, 'This order is pay-at-pickup');
    if (order.foodPaymentStatus !== 'pending') throw new ApiError(409, 'You already marked this as paid');
    const to = nextOrderStatus(order.status, 'claim_food_paid', 'buyer');
    const [moved] = await db
      .update(orders)
      .set({ status: to, foodPaymentStatus: 'buyer_claimed', foodPaymentUtr: utr || null, foodPaymentClaimedAt: now, updatedAt: now })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'fee_paid'), eq(orders.foodPaymentStatus, 'pending')))
      .returning();
    if (!moved) throw new ApiError(409, 'This order was just updated — refresh');
    await db.insert(orderEvents).values({ orderId, status: to, note: `Buyer says the UPI payment of ${formatINR(order.foodTotalInPaise)} was made${utr ? ` (UTR ${utr})` : ''}` });
    if (order.sellerId) await notify(order.sellerId, `Order #${orderId}: confirm payment`, `The buyer says they paid ${formatINR(order.foodTotalInPaise)} by UPI${utr ? ` — UTR ${utr}` : ''}. Check your UPI app, then confirm.`, '/seller/orders');
    return ok({ ok: true, status: to });
  }

  if (!isKitchen) throw new ApiError(403, 'Only the kitchen can do that');

  if (action === 'confirm' || action === 'not_received') {
    if (order.foodPaymentStatus !== 'buyer_claimed') throw new ApiError(409, 'There is no UPI payment waiting for confirmation');
    const wasAwaiting = order.status === 'awaiting_kitchen_payment_confirmation';
    const patch = action === 'confirm' ? { foodPaymentStatus: 'confirmed', foodPaymentConfirmedAt: now } : { foodPaymentStatus: 'not_received' };
    // Back to fee_paid only if the kitchen has not already accepted meanwhile.
    const to = wasAwaiting ? nextOrderStatus(order.status, action === 'confirm' ? 'confirm_food_paid' : 'food_not_received', session.role === 'admin' ? 'admin' : 'seller') : order.status;
    const [moved] = await db
      .update(orders)
      .set({ ...patch, status: to, updatedAt: now })
      .where(and(eq(orders.id, orderId), eq(orders.foodPaymentStatus, 'buyer_claimed')))
      .returning();
    if (!moved) throw new ApiError(409, 'This order was just updated — refresh');
    await db.insert(orderEvents).values({ orderId, status: to, note: action === 'confirm' ? 'Kitchen confirmed the UPI payment' : 'Kitchen reports the UPI payment was NOT received' });
    if (action === 'confirm') {
      await notify(order.buyerId, `Order #${orderId}: payment confirmed ✅`, 'The kitchen received your UPI payment.', `/orders/${orderId}`);
    } else {
      await db.insert(complaints).values({
        orderId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        category: 'not_received',
        description: `Kitchen reports the UPI payment of ${formatINR(order.foodTotalInPaise)} was not received${order.foodPaymentUtr ? ` (buyer's UTR: ${order.foodPaymentUtr})` : ''}.`,
        raisedBy: 'seller',
      });
      await notify(order.buyerId, `Order #${orderId}: payment not found`, 'The kitchen could not find your UPI payment. PadosiPlate will look into it — please keep your UPI receipt.', `/orders/${orderId}`);
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
      for (const a of admins) await notify(a.id, `Kitchen payment dispute — order #${orderId}`, 'Kitchen says UPI payment not received.', '/admin/complaints');
    }
    return ok({ ok: true, status: to });
  }

  // paid_at_handover
  if (order.foodPaymentMode !== 'pay_at_pickup') throw new ApiError(409, 'This order was paid by UPI up front');
  if (!['ready', 'out_for_delivery'].includes(order.status)) throw new ApiError(409, 'Record this when the food is ready for handover');
  if (order.foodPaymentStatus === 'at_handover') return ok({ ok: true, status: order.status });
  await db.update(orders).set({ foodPaymentStatus: 'at_handover', foodPaymentConfirmedAt: now }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, status: order.status, note: 'Kitchen recorded: paid at handover' });
  return ok({ ok: true, status: order.status });
});
