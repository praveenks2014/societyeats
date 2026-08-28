import { desc, eq, inArray } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { deliveries, orderItems, orders, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db
    .select({ order: orders, buyer: users })
    .from(orders)
    .innerJoin(users, eq(orders.buyerId, users.id))
    .where(eq(orders.sellerId, session.uid))
    .orderBy(desc(orders.createdAt))
    .limit(60);

  const ids = rows.map((r) => r.order.id);
  const items = ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];
  const dels = ids.length
    ? await db.select().from(deliveries).where(inArray(deliveries.orderId, ids))
    : [];

  return ok({
    orders: rows.map(({ order, buyer }) => ({
      ...order,
      otpCode: undefined, // OTP belongs to the buyer
      buyerName: buyer.name,
      items: items.filter((i) => i.orderId === order.id),
      delivery: dels.find((d) => d.orderId === order.id) ?? null,
    })),
  });
});
