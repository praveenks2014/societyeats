import { and, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listings } from '@/lib/db/schema';
import { assertCanPublish, type ListingBody } from '@/lib/seller';

export const dynamic = 'force-dynamic';

export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller']);
  const id = Number(params.id);
  const body = await readJson<Partial<ListingBody>>(req);
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.sellerId, session.uid)));
  if (!existing) throw new ApiError(404, 'Listing not found');

  if (body.isActive === true && !existing.isActive) await assertCanPublish(session.uid);

  const [updated] = await db
    .update(listings)
    .set({
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description?.trim() } : {}),
      ...(body.priceRupees !== undefined ? { priceInPaise: Math.round(body.priceRupees * 100) } : {}),
      ...(body.isVeg !== undefined ? { isVeg: body.isVeg } : {}),
      ...(body.cuisine !== undefined ? { cuisine: body.cuisine.trim() } : {}),
      ...(body.photoUrl !== undefined ? { photoUrl: body.photoUrl?.trim() || null } : {}),
      ...(body.prepTimeMins !== undefined ? { prepTimeMins: Math.max(5, body.prepTimeMins) } : {}),
      ...(body.availableQty !== undefined ? { availableQty: Math.max(0, body.availableQty) } : {}),
      ...(body.days || body.slots
        ? {
            slotsJson: {
              days: body.days?.length ? body.days : existing.slotsJson?.days ?? [],
              slots: body.slots?.length ? body.slots : existing.slotsJson?.slots ?? [],
            },
          }
        : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    })
    .where(eq(listings.id, id))
    .returning();
  return ok({ listing: updated });
});

export const DELETE = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession(['seller']);
  const id = Number(params.id);
  const db = await getDb();
  // soft delete — order history references listings
  const [updated] = await db
    .update(listings)
    .set({ isActive: false, availableQty: 0 })
    .where(and(eq(listings.id, id), eq(listings.sellerId, session.uid)))
    .returning();
  if (!updated) throw new ApiError(404, 'Listing not found');
  return ok({ ok: true });
});
