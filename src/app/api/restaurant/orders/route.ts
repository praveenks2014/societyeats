import { desc, eq, inArray } from 'drizzle-orm';
import { assertRestaurantConsoleEnabled } from '@/lib/kitchen/gate';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orderItems, orders, restaurants, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await assertRestaurantConsoleEnabled();
  const session = await requireSession(['restaurant']);
  const db = await getDb();
  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.managerUserId, session.uid));
  if (!restaurant) throw new ApiError(404, 'No restaurant linked to this account');

  const rows = await db
    .select({ order: orders, buyer: users })
    .from(orders)
    .innerJoin(users, eq(orders.buyerId, users.id))
    .where(eq(orders.restaurantId, restaurant.id))
    .orderBy(desc(orders.createdAt))
    .limit(60);

  const ids = rows.map((r) => r.order.id);
  const items = ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];

  return ok({
    restaurant: { id: restaurant.id, name: restaurant.name, counterNumber: restaurant.counterNumber },
    orders: rows.map(({ order, buyer }) => ({
      ...order,
      otpCode: undefined, // buyer shows the OTP at the counter
      buyerName: buyer.name,
      items: items.filter((i) => i.orderId === order.id),
    })),
  });
});
