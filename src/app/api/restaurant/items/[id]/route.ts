import { and, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { restaurantItems, restaurants } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['restaurant']);
  const db = await getDb();
  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.managerUserId, session.uid));
  if (!restaurant) throw new ApiError(404, 'No restaurant linked to this account');

  const body = await readJson<{ title?: string; priceRupees?: number; isVeg?: boolean; stockQty?: number; isActive?: boolean }>(req);
  const [updated] = await db
    .update(restaurantItems)
    .set({
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.priceRupees !== undefined ? { priceInPaise: Math.round(body.priceRupees * 100) } : {}),
      ...(body.isVeg !== undefined ? { isVeg: body.isVeg } : {}),
      ...(body.stockQty !== undefined ? { stockQty: Math.max(0, body.stockQty) } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    })
    .where(and(eq(restaurantItems.id, Number(params.id)), eq(restaurantItems.restaurantId, restaurant.id)))
    .returning();
  if (!updated) throw new ApiError(404, 'Item not found');
  return ok({ item: updated });
});
