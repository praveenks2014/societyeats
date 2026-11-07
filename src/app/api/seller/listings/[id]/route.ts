import { and, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { listings } from '@/lib/db/schema';
import { moderationAfterEdit } from '@/lib/dishes/moderation';
import { dishRuleColumns } from '@/lib/dishes/columns';
import { listingPatchSchema, rupeesToPaise } from '@/lib/seller';

export const dynamic = 'force-dynamic';

export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller']);
  const id = Number(params.id);
  const parsed = listingPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const body = parsed.data;
  const db = await getDb();
  const [existing] = await db.select().from(listings).where(and(eq(listings.id, id), eq(listings.sellerId, session.uid)));
  if (!existing) throw new ApiError(404, 'Listing not found');
  const settings = await getPlatformSettings();

  const next = {
    title: body.title ?? existing.title,
    photoUrl: body.photoUrl !== undefined ? body.photoUrl?.trim() || null : existing.photoUrl,
    priceInPaise: body.priceRupees !== undefined ? rupeesToPaise(body.priceRupees) : existing.priceInPaise,
  };
  // Re-run the dish rules on the merged dish whenever a rule or text field is touched (a plain pause/go-live toggle is exempt).
  const touchesRules = ['title', 'description', 'cuisine', 'foodMark', 'ingredients', 'allergens', 'spiceLevel', 'portionSize', 'bestWithinHours', 'storageAdvice', 'leadTimeDays', 'maxPortionsPerSlot', 'photos', 'isPackaged', 'packaged'].some((k) => k in body);
  const rules = touchesRules
    ? dishRuleColumns(
        {
          title: next.title,
          description: body.description ?? existing.description,
          cuisine: body.cuisine ?? existing.cuisine,
          foodMark: (body.foodMark ?? existing.foodMark) as 'veg' | 'egg' | 'non_veg',
          ingredients: body.ingredients ?? existing.ingredients ?? '',
          allergens: body.allergens ?? (existing.allergensDeclared ? (existing.allergensJson?.length ? existing.allergensJson : ['none']) : []),
          spiceLevel: body.spiceLevel !== undefined ? body.spiceLevel : existing.spiceLevel,
          portionSize: body.portionSize !== undefined ? body.portionSize : existing.portionSize,
          bestWithinHours: body.bestWithinHours !== undefined ? body.bestWithinHours : existing.bestWithinHours,
          storageAdvice: body.storageAdvice !== undefined ? body.storageAdvice : existing.storageAdvice,
          leadTimeDays: body.leadTimeDays ?? existing.leadTimeDays,
          maxPortionsPerSlot: body.maxPortionsPerSlot !== undefined ? body.maxPortionsPerSlot : existing.maxPortionsPerSlot,
          photos: body.photos ?? existing.photosJson ?? undefined,
          isPackaged: body.isPackaged ?? existing.isPackaged,
          packaged: body.packaged !== undefined ? body.packaged : existing.packagedJson,
        },
        settings,
      )
    : null;
  if (rules && (!(body.ingredients ?? existing.ingredients) || !(body.allergens ?? existing.allergensDeclared))) throw new ApiError(400, 'Add the ingredients and allergens to save this dish');
  let status = moderationAfterEdit(existing.moderationStatus, existing.approvedSnapshotJson, next, settings.dishModerationEnabled);
  if (rules?.healthClaim && status === 'approved') status = 'pending';
  const becameApproved = status === 'approved' && existing.moderationStatus !== 'approved';

  const [updated] = await db
    .update(listings)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.priceRupees !== undefined ? { priceInPaise: next.priceInPaise } : {}),
      ...(rules ? rules.columns : body.isVeg !== undefined ? { isVeg: body.isVeg } : {}),
      ...(body.cuisine !== undefined ? { cuisine: body.cuisine } : {}),
      ...(body.photoUrl !== undefined ? { photoUrl: next.photoUrl } : {}),
      ...(body.prepTimeMins !== undefined ? { prepTimeMins: Math.max(5, Math.round(body.prepTimeMins)) } : {}),
      ...(body.availableQty !== undefined ? { availableQty: body.availableQty } : {}),
      ...(body.days || body.slots
        ? { slotsJson: { days: body.days?.length ? body.days : existing.slotsJson?.days ?? [], slots: body.slots?.length ? body.slots : existing.slotsJson?.slots ?? [] } }
        : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      moderationStatus: status,
      ...(status === 'pending' && existing.moderationStatus !== 'pending' ? { moderationNote: null, moderationReasonCategory: null } : {}),
      ...(becameApproved ? { moderatedAt: new Date(), approvedSnapshotJson: next } : {}),
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
