import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orderEvents, orders, payments, restaurants } from '@/lib/db/schema';
import { dispatchDelivery } from '@/lib/delivery/orchestrator';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

type Action = 'accept' | 'reject' | 'preparing' | 'ready';

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller', 'restaurant', 'admin']);
  const { action } = await readJson<{ action: Action }>(req);
  const orderId = Number(params.id);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');

  // ownership
  if (session.role === 'seller' && order.sellerId !== session.uid) throw new ApiError(403, 'Not your order');
  let counterNumber = '';
  if (order.restaurantId) {
    const [rest] = await db.select().from(restaurants).where(eq(restaurants.id, order.restaurantId));
    counterNumber = rest?.counterNumber ?? '';
    if (session.role === 'restaurant' && rest?.managerUserId !== session.uid) {
      throw new ApiError(403, 'Not your counter');
    }
  }

  const transitions: Record<Action, { from: string[]; to: typeof order.status; note: string }> = {
    accept: { from: ['paid'], to: 'accepted', note: 'Order accepted by the kitchen' },
    reject: { from: ['paid'], to: 'refund_pending', note: 'Order rejected — refund initiated' },
    preparing: { from: ['accepted'], to: 'preparing', note: 'Cooking started' },
    ready: {
      from: ['preparing', 'accepted'],
      to: 'ready',
      note: order.type === 'mall_pickup' ? `Ready — collect at Counter ${counterNumber}` : 'Packed and ready for pickup',
    },
  };

  const t = transitions[action];
  if (!t) throw new ApiError(400, 'Unknown action');
  if (!t.from.includes(order.status)) {
    throw new ApiError(409, `Cannot ${action} an order that is ${order.status.replaceAll('_', ' ')}`);
  }

  await db.update(orders).set({ status: t.to, updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, status: t.to, note: t.note });

  if (action === 'reject') {
    await db.update(payments).set({ status: 'refunded' }).where(eq(payments.orderId, orderId));
    await notify(order.buyerId, `Order #${orderId} was declined`, 'The kitchen could not take your order. Your refund is on the way.', `/orders/${orderId}`);
  }
  if (action === 'accept') {
    await notify(order.buyerId, `Order #${orderId} accepted ✅`, 'The kitchen has started on your order.', `/orders/${orderId}`);
  }
  if (action === 'ready') {
    if (order.type === 'home_delivery') {
      // the signature moment: orchestrated dispatch with failover
      await dispatchDelivery(orderId);
    } else {
      await notify(
        order.buyerId,
        `Order ready — collect at Counter ${counterNumber} 🔔`,
        `Show your 4-digit OTP at the counter to pick up order #${orderId}.`,
        `/orders/${orderId}`,
      );
    }
  }

  const [updated] = await db.select().from(orders).where(eq(orders.id, orderId));
  return ok({ order: updated });
});
