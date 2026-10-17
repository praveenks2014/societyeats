import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { orderEvents, orders, restaurants } from '@/lib/db/schema';
import { dispatchDelivery } from '@/lib/delivery/orchestrator';
import { kitchenGate } from '@/lib/kitchen/gate';
import { cancelOrderWithRefund } from '@/lib/orders/lifecycle';
import { nextOrderStatus, type Actor, type OrderAction } from '@/lib/orders/state';

export const dynamic = 'force-dynamic';

type Action = 'accept' | 'reject' | 'preparing' | 'ready' | 'out_for_delivery';
const ACTIONS: Action[] = ['accept', 'reject', 'preparing', 'ready', 'out_for_delivery'];

const NOTES: Record<Exclude<Action, 'reject'>, string> = {
  accept: 'Order accepted by the kitchen',
  preparing: 'Cooking started',
  ready: 'Packed and ready',
  out_for_delivery: 'Seller is out for delivery',
};

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller', 'restaurant', 'admin']);
  const { action, note } = await readJson<{ action: Action; note?: string }>(req);
  if (!ACTIONS.includes(action)) throw new ApiError(400, 'Unknown action');
  const orderId = Number(params.id);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');
  const actor = session.role as Actor;

  // ownership
  if (session.role === 'seller' && order.sellerId !== session.uid) throw new ApiError(403, 'Not your order');
  let counterNumber = '';
  if (order.restaurantId) {
    const [rest] = await db.select().from(restaurants).where(eq(restaurants.id, order.restaurantId));
    counterNumber = rest?.counterNumber ?? '';
    if (session.role === 'restaurant' && rest?.managerUserId !== session.uid) throw new ApiError(403, 'Not your counter');
  }
  if (action === 'out_for_delivery' && order.fulfillmentType !== 'seller_delivery') {
    throw new ApiError(400, "This order's fulfillment type doesn't use a manual out-for-delivery step");
  }

  if (action === 'reject') {
    const r = await cancelOrderWithRefund(orderId, { actor, reason: 'rejected', note });
    const [updated] = await db.select().from(orders).where(eq(orders.id, orderId));
    return ok({ order: updated, refunded: r.refunded });
  }

  const to = nextOrderStatus(order.status, action as OrderAction, actor);

  if (action === 'accept' && order.type === 'home_delivery' && session.role !== 'admin') {
    // Only a kitchen that is approved, subscribed, FSSAI-eligible and has payment details can take NEW orders.
    // (It can always finish orders it already accepted — those actions below are not gated.)
    const gate = await kitchenGate(order.sellerId!);
    if (!gate.ok) throw new ApiError(403, `You can't accept new orders right now: ${gate.reasons.join('; ')}`);
  }

  const [moved] = await db
    .update(orders)
    .set({ status: to, updatedAt: new Date(), ...(action === 'accept' ? { acceptBy: null } : {}) })
    .where(eq(orders.id, orderId))
    .returning();
  void moved;
  await db.insert(orderEvents).values({ orderId, status: to, note: order.type === 'mall_pickup' && action === 'ready' ? `Ready — collect at Counter ${counterNumber}` : NOTES[action] });

  if (action === 'accept') {
    await notify(order.buyerId, `Order #${orderId} accepted ✅`, 'The kitchen has started on your order.', `/orders/${orderId}`);
  }
  if (action === 'ready') {
    if (order.fulfillmentType === 'platform_delivery') {
      await dispatchDelivery(orderId);
    } else if (order.type === 'mall_pickup') {
      await notify(order.buyerId, `Order ready — collect at Counter ${counterNumber} 🔔`, `Show your 4-digit OTP at the counter to pick up order #${orderId}.`, `/orders/${orderId}`);
    } else if (order.fulfillmentType === 'self_pickup') {
      await notify(order.buyerId, 'Order ready for pickup 🔔', `Show your 4-digit OTP to the kitchen to collect order #${orderId}.`, `/orders/${orderId}`);
    } else {
      await notify(order.buyerId, 'Order ready — on its way soon 🔔', `The kitchen will deliver order #${orderId} themselves and ask for your 4-digit OTP at the door.`, `/orders/${orderId}`);
    }
  }
  if (action === 'out_for_delivery') {
    await notify(order.buyerId, 'Your order is on the way 🛵', `The kitchen is out for delivery with order #${orderId} — have your 4-digit OTP ready.`, `/orders/${orderId}`);
  }

  const [updated] = await db.select().from(orders).where(eq(orders.id, orderId));
  return ok({ order: updated });
});
