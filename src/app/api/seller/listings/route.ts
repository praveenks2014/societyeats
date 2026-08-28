import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listings } from '@/lib/db/schema';
import { assertCanPublish, type ListingBody } from '@/lib/seller';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.sellerId, session.uid))
    .orderBy(desc(listings.createdAt));
  return ok({ listings: rows });
});

export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const body = await readJson<ListingBody>(req);
  if (!body.title?.trim()) throw new ApiError(400, 'Dish name required');
  if (!body.priceRupees || body.priceRupees < 1) throw new ApiError(400, 'Price required');
  if (!body.cuisine?.trim()) throw new ApiError(400, 'Cuisine required');

  const wantActive = body.isActive !== false;
  if (wantActive) await assertCanPublish(session.uid);

  const db = await getDb();
  const [row] = await db
    .insert(listings)
    .values({
      sellerId: session.uid,
      title: body.title.trim(),
      description: body.description?.trim(),
      priceInPaise: Math.round(body.priceRupees * 100),
      isVeg: !!body.isVeg,
      cuisine: body.cuisine.trim(),
      photoUrl: body.photoUrl?.trim() || null,
      prepTimeMins: Math.max(5, body.prepTimeMins || 30),
      availableQty: Math.max(0, body.availableQty || 0),
      slotsJson: { days: body.days?.length ? body.days : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], slots: body.slots?.length ? body.slots : ['lunch', 'dinner'] },
      isActive: wantActive,
    })
    .returning();
  return ok({ listing: row });
});
