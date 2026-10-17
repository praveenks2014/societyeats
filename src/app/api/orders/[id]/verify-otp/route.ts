import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { deliveries, orderEvents, orders } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';
import { rateLimit } from '@/lib/rate-limit';
import { maybeGrantReferralCredit } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

/**
 * OTP handshake at handover (DECISIONS.md #37+ generalizes this beyond just
 * home-delivery vs mall-pickup to every fulfillment type):
 * - platform_delivery: the rider enters the buyer's OTP (simulated from the
 *   mock tracking screen) → delivered
 * - seller_delivery: the seller enters the buyer's OTP at the door → delivered
 * - self_pickup (home kitchen OR mall counter): the seller/counter staff
 *   enters the buyer's OTP → picked_up
 */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  // a 4-digit OTP is only 10,000 combinations — throttle guesses hard,
  // keyed per order+account so it can't be used to lock other buyers out
  await rateLimit(`verify-otp:${orderId}:${session.uid}`, { limit: 8, windowMs: 10 * 60 * 1000 });
  const { otp } = await readJson<{ otp: string }>(req);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.otpCode !== String(otp).trim()) throw new ApiError(400, 'Wrong OTP — check the 4 digits and try again');

  const isRiderOrSellerDelivered = order.fulfillmentType === 'platform_delivery' || order.fulfillmentType === 'seller_delivery';

  if (isRiderOrSellerDelivered) {
    if (order.status !== 'out_for_delivery') {
      throw new ApiError(409, 'Order is not out for delivery yet');
    }
    await db.update(orders).set({ status: 'delivered', updatedAt: new Date() }).where(eq(orders.id, orderId));
    await db.update(deliveries).set({ status: 'delivered' }).where(eq(deliveries.orderId, orderId));
    const who = order.fulfillmentType === 'seller_delivery' ? 'by the seller' : 'by rider';
    await db.insert(orderEvents).values({ orderId, status: 'delivered', note: `OTP verified ${who} — delivered` });
    if (order.sellerId) {
      await notify(order.sellerId, `Order #${orderId} delivered 🎉`, 'Payment will reflect in your earnings.', '/seller/earnings');
    }
    await notify(order.buyerId, 'Enjoy your meal! 🍽️', `Order #${orderId} was delivered. Tell the kitchen how it was.`, `/orders/${orderId}`);
    // Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+): a referred buyer's
    // first COMPLETED order (not just placed) is what earns the referrer credit.
    await maybeGrantReferralCredit({ id: orderId, buyerId: order.buyerId });
    return ok({ ok: true, status: 'delivered' });
  }

  // self_pickup (home kitchen or mall counter)
  if (order.status !== 'ready') throw new ApiError(409, 'Order is not ready for pickup yet');
  await db.update(orders).set({ status: 'picked_up', updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, status: 'picked_up', note: 'OTP verified — picked up' });
  if (order.sellerId) {
    await notify(order.sellerId, `Order #${orderId} collected 🎉`, 'Payment will reflect in your earnings.', '/seller/earnings');
  }
  await notify(order.buyerId, 'Order picked up 🛍️', `Enjoy! Rate your order #${orderId} when you're done.`, `/orders/${orderId}`);
  await maybeGrantReferralCredit({ id: orderId, buyerId: order.buyerId });
  return ok({ ok: true, status: 'picked_up' });
});
