import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { deliveries, orderEvents, orders } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

/**
 * OTP handshake at handover:
 * - home delivery: the rider enters the buyer's OTP (simulated from the mock
 *   tracking screen) → delivered
 * - mall pickup: the counter staff enters the buyer's OTP → picked_up
 */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const { otp } = await readJson<{ otp: string }>(req);
  const orderId = Number(params.id);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.otpCode !== String(otp).trim()) throw new ApiError(400, 'Wrong OTP — check the 4 digits and try again');

  if (order.type === 'home_delivery') {
    if (order.status !== 'out_for_delivery') {
      throw new ApiError(409, 'Order is not out for delivery yet');
    }
    await db.update(orders).set({ status: 'delivered', updatedAt: new Date() }).where(eq(orders.id, orderId));
    await db.update(deliveries).set({ status: 'delivered' }).where(eq(deliveries.orderId, orderId));
    await db.insert(orderEvents).values({ orderId, status: 'delivered', note: 'OTP verified by rider — delivered' });
    if (order.sellerId) {
      await notify(order.sellerId, `Order #${orderId} delivered 🎉`, 'Payment will reflect in your earnings.', '/seller/earnings');
    }
    await notify(order.buyerId, 'Enjoy your meal! 🍽️', `Order #${orderId} was delivered. Tell the kitchen how it was.`, `/orders/${orderId}`);
    return ok({ ok: true, status: 'delivered' });
  }

  if (order.status !== 'ready') throw new ApiError(409, 'Order is not ready for pickup yet');
  await db.update(orders).set({ status: 'picked_up', updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, status: 'picked_up', note: 'OTP verified at the counter — picked up' });
  await notify(order.buyerId, 'Order picked up 🛍️', `Enjoy! Rate your order #${orderId} when you're done.`, `/orders/${orderId}`);
  return ok({ ok: true, status: 'picked_up' });
});
