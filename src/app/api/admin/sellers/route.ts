import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles, societies, users } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { sellerCompletedOrderCount, sellerBadgeTier } from '@/lib/reputation';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const [rows, settings] = await Promise.all([
    db
      .select({ profile: sellerProfiles, user: users, society: societies })
      .from(sellerProfiles)
      .innerJoin(users, eq(sellerProfiles.userId, users.id))
      .leftJoin(societies, eq(users.societyId, societies.id)),
    getPlatformSettings(),
  ]);
  const sellers = await Promise.all(
    rows.map(async (r) => {
      const completedOrderCount = await sellerCompletedOrderCount(r.profile.userId);
      return {
        userId: r.profile.userId,
        kitchenName: r.profile.kitchenName,
        name: r.user.name,
        phone: r.user.phone,
        society: r.society?.name ?? null,
        isApproved: r.profile.isApproved,
        fssaiStatus: r.profile.fssaiStatus,
        fssaiNumber: r.profile.fssaiNumber,
        rating: r.profile.rating,
        ratingCount: r.profile.ratingCount,
        completedOrderCount,
        badgeTier: sellerBadgeTier(completedOrderCount),
        // Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+).
        isFeatured: settings.featuredSellerId === String(r.profile.userId),
      };
    }),
  );
  return ok({ sellers });
});

export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const body = await readJson<{ userId: number; isApproved?: boolean; action?: 'feature' | 'unfeature' }>(req);
  const db = await getDb();

  // "Neighbour's kitchen of the week" — one admin-pickable slot, toggled per
  // seller (DECISIONS.md #87+). A second 'feature' click just replaces the
  // previous pick; 'unfeature' clears the slot entirely.
  if (body.action === 'feature' || body.action === 'unfeature') {
    const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, body.userId));
    if (!profile) throw new ApiError(404, 'Seller not found');
    await setPlatformSetting('featuredSellerId', body.action === 'feature' ? String(body.userId) : '');
    return ok({ ok: true });
  }

  if (typeof body.isApproved !== 'boolean') throw new ApiError(400, 'isApproved must be true or false');
  const [updated] = await db
    .update(sellerProfiles)
    .set({ isApproved: body.isApproved })
    .where(eq(sellerProfiles.userId, body.userId))
    .returning();
  if (!updated) throw new ApiError(404, 'Seller not found');
  if (body.isApproved) {
    await notify(
      body.userId,
      'Your kitchen is approved! 🎉',
      'You can publish dishes now (FSSAI step permitting). Welcome to GharSe.',
      '/seller',
    );
  }
  return ok({ ok: true });
});
