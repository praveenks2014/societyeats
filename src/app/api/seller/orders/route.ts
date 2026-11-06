import { desc, eq, inArray, notInArray, and } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { deliveries, orderItems, orders } from '@/lib/db/schema';
import { buyerHandle } from '@/lib/handles';
import { getPlatformSettings } from '@/lib/db/platform';
import { allowedActions, redactOrder } from '@/lib/orders/view';

export const dynamic = 'force-dynamic';

/**
 * The kitchen sees an order only after the buyer's platform fee is paid
 * (`fee_pending` / `expired` orders never appear). Buyers are shown by handle
 * only; their delivery address is included only for the kitchen's own
 * deliveries, once the order is accepted.
 */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sellerId, session.uid), notInArray(orders.status, ['fee_pending', 'expired'])))
    .orderBy(desc(orders.createdAt))
    .limit(60);

  const ids = rows.map((r) => r.id);
  const items = ids.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [];
  const dels = ids.length ? await db.select().from(deliveries).where(inArray(deliveries.orderId, ids)) : [];
  const settings = await getPlatformSettings();
  const now = new Date();

  return ok({
    orders: rows.map((order) => ({
      ...redactOrder(order, { uid: session.uid, role: 'seller' }, now),
      buyerName: buyerHandle(order.id, order.buyerId),
      items: items.filter((i) => i.orderId === order.id),
      delivery: dels.find((d) => d.orderId === order.id) ?? null,
      actions: allowedActions(order, { uid: session.uid, role: 'seller' }, { atDoorWaitMinutes: settings.atDoorWaitMinutes }, now),
    })),
  });
});
