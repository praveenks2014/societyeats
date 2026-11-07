import { and, desc, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { favourites, sellerProfiles, users } from '@/lib/db/schema';

async function assertEnabled() {
  if (!(await getPlatformSettings()).favouritesEnabled) throw new ApiError(404, 'Favourites are not available');
}

export async function setFavourite(userId: number, sellerId: number, on: boolean, notifyCooking = true) {
  await assertEnabled();
  const db = await getDb();
  if (userId === sellerId) throw new ApiError(400, 'You cannot follow your own kitchen');
  if (on) {
    const [k] = await db.select({ id: sellerProfiles.userId }).from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
    if (!k) throw new ApiError(404, 'Kitchen not found');
    await db.insert(favourites).values({ userId, sellerId, notifyCooking }).onConflictDoUpdate({ target: [favourites.userId, favourites.sellerId], set: { notifyCooking } });
  } else {
    await db.delete(favourites).where(and(eq(favourites.userId, userId), eq(favourites.sellerId, sellerId)));
  }
  return { favourite: on, notifyCooking };
}

export async function isFavourite(userId: number, sellerId: number): Promise<{ favourite: boolean; notifyCooking: boolean }> {
  const db = await getDb();
  const [f] = await db.select().from(favourites).where(and(eq(favourites.userId, userId), eq(favourites.sellerId, sellerId)));
  return { favourite: !!f, notifyCooking: f?.notifyCooking ?? true };
}

export async function listFavourites(userId: number) {
  const db = await getDb();
  const rows = await db
    .select({ f: favourites, kitchen: sellerProfiles.kitchenName, rating: sellerProfiles.rating, closedUntil: sellerProfiles.closedUntil })
    .from(favourites)
    .innerJoin(sellerProfiles, eq(sellerProfiles.userId, favourites.sellerId))
    .innerJoin(users, eq(users.id, favourites.sellerId))
    .where(eq(favourites.userId, userId))
    .orderBy(desc(favourites.createdAt));
  return rows.map((r) => ({ sellerId: r.f.sellerId, kitchen: r.kitchen, rating: r.rating, notifyCooking: r.f.notifyCooking, closedToday: !!r.closedUntil && r.closedUntil.getTime() > Date.now() }));
}
