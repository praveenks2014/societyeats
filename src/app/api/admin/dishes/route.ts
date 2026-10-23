import { and, desc, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listings, sellerProfiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Dish review queue (?status=pending by default). */
export const GET = api(async (req) => {
  await requireSession(['admin']);
  const status = req.nextUrl.searchParams.get('status') || 'pending';
  const db = await getDb();
  const rows = await db
    .select({ d: listings, kitchenName: sellerProfiles.kitchenName })
    .from(listings)
    .innerJoin(sellerProfiles, eq(listings.sellerId, sellerProfiles.userId))
    .where(and(status === 'all' ? undefined : eq(listings.moderationStatus, status)))
    .orderBy(desc(listings.id))
    .limit(200);
  return ok({ dishes: rows.map((r) => ({ ...r.d, kitchenName: r.kitchenName })) });
});
