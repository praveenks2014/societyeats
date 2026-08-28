import { desc, eq, inArray } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { deliveries, orders, payments, restaurants, sellerProfiles, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ order: orders, buyer: users })
    .from(orders)
    .innerJoin(users, eq(orders.buyerId, users.id))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  const ids = rows.map((r) => r.order.id);
  const pays = ids.length ? await db.select().from(payments).where(inArray(payments.orderId, ids)) : [];
  const dels = ids.length ? await db.select().from(deliveries).where(inArray(deliveries.orderId, ids)) : [];
  const profiles = await db.select().from(sellerProfiles);
  const rests = await db.select().from(restaurants);

  return ok({
    orders: rows.map(({ order, buyer }) => ({
      ...order,
      buyerName: buyer.name,
      vendorName:
        (order.sellerId && profiles.find((p) => p.userId === order.sellerId)?.kitchenName) ||
        (order.restaurantId && rests.find((r) => r.id === order.restaurantId)?.name) ||
        '—',
      payment: pays.find((p) => p.orderId === order.id) ?? null,
      delivery: dels.find((d) => d.orderId === order.id) ?? null,
    })),
  });
});
