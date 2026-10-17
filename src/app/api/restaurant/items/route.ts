import { desc, eq } from 'drizzle-orm';
import { assertRestaurantConsoleEnabled } from '@/lib/kitchen/gate';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { restaurantItems, restaurants } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

async function myRestaurant(uid: number) {
  const db = await getDb();
  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.managerUserId, uid));
  if (!restaurant) throw new ApiError(404, 'No restaurant linked to this account');
  return restaurant;
}

export const GET = api(async () => {
  await assertRestaurantConsoleEnabled();
  const session = await requireSession(['restaurant']);
  const restaurant = await myRestaurant(session.uid);
  const db = await getDb();
  const rows = await db
    .select()
    .from(restaurantItems)
    .where(eq(restaurantItems.restaurantId, restaurant.id))
    .orderBy(desc(restaurantItems.id));
  return ok({ restaurant, items: rows });
});

export const POST = api(async (req) => {
  await assertRestaurantConsoleEnabled();
  const session = await requireSession(['restaurant']);
  const restaurant = await myRestaurant(session.uid);
  const body = await readJson<{ title: string; priceRupees: number; isVeg: boolean; photoUrl?: string; stockQty: number }>(req);
  if (!body.title?.trim() || !body.priceRupees) throw new ApiError(400, 'Title and price required');
  const db = await getDb();
  const [row] = await db
    .insert(restaurantItems)
    .values({
      restaurantId: restaurant.id,
      title: body.title.trim(),
      priceInPaise: Math.round(body.priceRupees * 100),
      isVeg: !!body.isVeg,
      photoUrl: body.photoUrl?.trim() || null,
      stockQty: Math.max(0, body.stockQty || 0),
      isActive: true,
    })
    .returning();
  return ok({ item: row });
});
