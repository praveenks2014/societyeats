import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { listings } from '@/lib/db/schema';
import { moderationOnCreate } from '@/lib/dishes/moderation';
import { listingCreateSchema, rupeesToPaise } from '@/lib/seller';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db.select().from(listings).where(eq(listings.sellerId, session.uid)).orderBy(desc(listings.createdAt));
  return ok({ listings: rows });
});

/**
 * Dishes can be added at any time (they are what the admin reviews with the
 * listing request). Whether buyers see a dish is decided centrally: kitchen
 * approved + subscribed + FSSAI gate + dish approved.
 */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = listingCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const body = parsed.data;
  const settings = await getPlatformSettings();
  const moderationStatus = moderationOnCreate(settings.dishModerationEnabled);
  const priceInPaise = rupeesToPaise(body.priceRupees);

  const db = await getDb();
  const [row] = await db
    .insert(listings)
    .values({
      sellerId: session.uid,
      title: body.title,
      description: body.description,
      priceInPaise,
      isVeg: body.isVeg,
      cuisine: body.cuisine,
      photoUrl: body.photoUrl?.trim() || null,
      prepTimeMins: Math.max(5, Math.round(body.prepTimeMins || 30)),
      availableQty: body.availableQty,
      slotsJson: { days: body.days, slots: body.slots },
      isActive: body.isActive !== false,
      moderationStatus,
      moderatedAt: moderationStatus === 'approved' ? new Date() : null,
      approvedSnapshotJson: moderationStatus === 'approved' ? { title: body.title, photoUrl: body.photoUrl?.trim() || null, priceInPaise } : null,
    })
    .returning();
  return ok({ listing: row });
});
