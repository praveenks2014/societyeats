import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { kitchenSubscriptions, listings, sellerProfiles, societies, users } from '@/lib/db/schema';
import { daysLeft, overallStatus } from '@/lib/subscriptions/status';

export const dynamic = 'force-dynamic';

/** All kitchens, optionally filtered by listing state and society. */
export const GET = api(async (req) => {
  await requireSession(['admin']);
  const state = req.nextUrl.searchParams.get('state');
  const societyId = Number(req.nextUrl.searchParams.get('societyId')) || null;
  const db = await getDb();
  const settings = await getPlatformSettings();
  const rows = await db
    .select({ p: sellerProfiles, u: users, s: societies })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(and(state && state !== 'all' ? eq(sellerProfiles.listingState, state) : undefined, societyId ? eq(users.societyId, societyId) : undefined))
    .orderBy(desc(sellerProfiles.listingSubmittedAt), desc(sellerProfiles.userId));
  const ids = rows.map((r) => r.p.userId);
  const subs = ids.length ? await db.select().from(kitchenSubscriptions).where(inArray(kitchenSubscriptions.sellerId, ids)) : [];
  const dishCounts = ids.length
    ? await db
        .select({ sellerId: listings.sellerId, total: sql<number>`count(*)`, pending: sql<number>`count(*) filter (where ${listings.moderationStatus} = 'pending')` })
        .from(listings)
        .where(inArray(listings.sellerId, ids))
        .groupBy(listings.sellerId)
    : [];
  const now = new Date();
  return ok({
    kitchens: rows.map((r) => {
      const mine = subs.filter((x) => x.sellerId === r.p.userId);
      const dc = dishCounts.find((d) => d.sellerId === r.p.userId);
      return {
        userId: r.p.userId,
        kitchenName: r.p.kitchenName,
        ownerName: r.u.name,
        blocked: !!r.u.blockedAt,
        society: r.s?.name ?? null,
        tower: r.p.tower,
        state: r.p.listingState,
        submittedAt: r.p.listingSubmittedAt,
        fssaiStatus: r.p.fssaiStatus,
        subscription: overallStatus(mine, now, settings.subscriptionGraceDays),
        subscriptionDaysLeft: daysLeft(mine, now),
        dishes: Number(dc?.total ?? 0),
        pendingDishes: Number(dc?.pending ?? 0),
        rating: r.p.rating,
        ratingCount: r.p.ratingCount,
        isFeatured: settings.featuredSellerId === String(r.p.userId),
      };
    }),
  });
});
