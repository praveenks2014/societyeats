import { and, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { deliveries, orderEvents, orders } from '@/lib/db/schema';
import { nextOrderStatus } from '@/lib/orders/state';
import { rateLimit } from '@/lib/rate-limit';
import { maybeGrantReferralCredit } from '@/lib/referrals';
import { safeEqualHex } from '@/lib/payments/signature';

export const dynamic = 'force-dynamic';

/**
 * Handover OTP. The BUYER sees the 4-digit code; the order's KITCHEN (or an
 * admin) enters it at pickup / at the door. A buyer can never complete their
 * own order. For home orders the food payment must be settled first:
 * UPI orders need the kitchen's "payment received"; pay-at-pickup orders need
 * "paid at handover" recorded.
 */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller', 'restaurant', 'admin']);
  const orderId = Number(params.id);
  // a 4-digit OTP is only 10,000 combinations — throttle guesses hard
  await rateLimit(`verify-otp:${orderId}:${session.uid}`, { limit: 8, windowMs: 10 * 60 * 1000 });
  const { otp } = await readJson<{ otp: string }>(req);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');

  // Authorisation: the order's own seller, the counter manager, or an admin.
  if (session.role === 'seller' && order.sellerId !== session.uid) throw new ApiError(403, 'Only the kitchen that owns this order can complete it');
  if (session.role === 'restaurant') {
    const { restaurants } = await import('@/lib/db/schema');
    const [rest] = order.restaurantId ? await db.select().from(restaurants).where(eq(restaurants.id, order.restaurantId)) : [];
    if (!rest || rest.managerUserId !== session.uid) throw new ApiError(403, 'Not your counter');
  }

  const delivered = order.fulfillmentType === 'platform_delivery' || order.fulfillmentType === 'seller_delivery';
  const action = delivered ? 'handover_delivery' : 'handover_pickup';
  const to = nextOrderStatus(order.status, action, session.role === 'admin' ? 'admin' : 'seller');

  if (order.type === 'home_delivery' && !['confirmed', 'at_handover'].includes(order.foodPaymentStatus ?? '')) {
    throw new ApiError(
      409,
      order.foodPaymentMode === 'pay_at_pickup'
        ? 'Record that the buyer paid you at handover before entering the OTP'
        : 'Confirm that you received the buyer’s UPI payment before entering the OTP',
    );
  }
  if (!safeEqualHex(order.otpCode, String(otp ?? '').trim())) throw new ApiError(400, 'Wrong OTP — check the 4 digits and try again');

  // Exactly-once completion.
  const [done] = await db
    .update(orders)
    .set({ status: to, completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
    .returning();
  if (!done) throw new ApiError(409, 'This order was just updated — refresh');
  if (delivered) await db.update(deliveries).set({ status: 'delivered' }).where(eq(deliveries.orderId, orderId));
  await db.insert(orderEvents).values({ orderId, status: to, note: delivered ? 'OTP verified at the door — delivered' : 'OTP verified — picked up' });

  if (order.sellerId) await notify(order.sellerId, `Order #${orderId} ${delivered ? 'delivered' : 'collected'} 🎉`, 'Nicely done.', '/seller/orders');
  await notify(order.buyerId, delivered ? 'Enjoy your meal! 🍽️' : 'Order picked up 🛍️', `Order #${orderId} is complete. Tell the kitchen how it was.`, `/orders/${orderId}`);
  await maybeGrantReferralCredit({ id: orderId, buyerId: order.buyerId });
  return ok({ ok: true, status: to });
});
