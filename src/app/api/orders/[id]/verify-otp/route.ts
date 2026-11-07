import { and, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { orderEvents, orders, restaurants } from '@/lib/db/schema';
import { nextOrderStatus } from '@/lib/orders/state';
import { safeEqualHex } from '@/lib/payments/signature';
import { rateLimit } from '@/lib/rate-limit';
import { maybeGrantReferralCredit } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

/**
 * Mall (order-ahead pickup, feature-flagged off) handover: the buyer shows a 4-digit OTP at the counter.
 * Home-kitchen orders do NOT use an OTP — they finish through the at-the-door payment flow.
 */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['restaurant', 'admin']);
  const orderId = Number(params.id);
  await rateLimit(`verify-otp:${orderId}:${session.uid}`, { limit: 8, windowMs: 10 * 60 * 1000 });
  const { otp } = await readJson<{ otp: string }>(req);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.type !== 'mall_pickup') throw new ApiError(404, 'Order not found');
  if (session.role === 'restaurant') {
    const [rest] = order.restaurantId ? await db.select().from(restaurants).where(eq(restaurants.id, order.restaurantId)) : [];
    if (!rest || rest.managerUserId !== session.uid) throw new ApiError(403, 'Not your counter');
  }
  const to = nextOrderStatus(order.status, 'handover_pickup', session.role === 'admin' ? 'admin' : 'restaurant');
  if (!safeEqualHex(order.otpCode, String(otp ?? '').trim())) throw new ApiError(400, 'Wrong OTP — check the 4 digits and try again');
  const [done] = await db.update(orders).set({ status: to, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.status, order.status))).returning();
  if (!done) throw new ApiError(409, 'This order was just updated — refresh');
  await db.insert(orderEvents).values({ orderId, status: to, note: 'OTP verified — picked up' });
  await notify(order.buyerId, 'Order picked up 🛍️', `Order #${orderId} is complete.`, `/orders/${orderId}`);
  await maybeGrantReferralCredit({ id: orderId, buyerId: order.buyerId });
  return ok({ ok: true, status: to });
});
