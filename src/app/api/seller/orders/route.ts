import { desc, eq, inArray, notInArray, and } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { deliveries, orderItems, orders } from '@/lib/db/schema';
import { buyerHandle } from '@/lib/handles';

export const dynamic = 'force-dynamic';

/**
 * The kitchen sees an order only after the buyer's platform fee is paid
 * (`placed` / `expired` orders never appear). Buyers are shown by handle
 * only; their delivery address is included only for the kitchen's own
 * deliveries, once the order is accepted.
 */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sellerId, session.uid), notInArray(orders.status, ['placed', 'expired'])))
    .orderBy(desc(orders.createdAt))
    .limit(60);

  const ids = rows.map((r) => r.id);
  const items = ids.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [];
  const dels = ids.length ? await db.select().from(deliveries).where(inArray(deliveries.orderId, ids)) : [];
  const acceptedStates = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up'];

  return ok({
    orders: rows.map((order) => ({
      ...order,
      otpCode: undefined, // OTP belongs to the buyer
      deliveryAddressJson: acceptedStates.includes(order.status) ? order.deliveryAddressJson : null,
      buyerName: buyerHandle(order.id, order.buyerId),
      items: items.filter((i) => i.orderId === order.id),
      delivery: dels.find((d) => d.orderId === order.id) ?? null,
    })),
  });
});
