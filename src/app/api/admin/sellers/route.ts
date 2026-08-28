import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles, societies, users } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ profile: sellerProfiles, user: users, society: societies })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id));
  return ok({
    sellers: rows.map((r) => ({
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
    })),
  });
});

export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const { userId, isApproved } = await readJson<{ userId: number; isApproved: boolean }>(req);
  const db = await getDb();
  const [updated] = await db
    .update(sellerProfiles)
    .set({ isApproved })
    .where(eq(sellerProfiles.userId, userId))
    .returning();
  if (!updated) throw new ApiError(404, 'Seller not found');
  if (isApproved) {
    await notify(
      userId,
      'Your kitchen is approved! 🎉',
      'You can publish dishes now (FSSAI step permitting). Welcome to GharSe.',
      '/seller',
    );
  }
  return ok({ ok: true });
});
