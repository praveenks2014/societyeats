import { desc, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ app: fssaiApplications, user: users, profile: sellerProfiles })
    .from(fssaiApplications)
    .innerJoin(users, eq(fssaiApplications.sellerId, users.id))
    .leftJoin(sellerProfiles, eq(fssaiApplications.sellerId, sellerProfiles.userId))
    .orderBy(desc(fssaiApplications.createdAt));
  return ok({
    applications: rows.map((r) => ({
      ...r.app,
      sellerName: r.user.name,
      sellerPhone: r.user.phone,
      kitchenName: r.profile?.kitchenName ?? '',
    })),
  });
});
