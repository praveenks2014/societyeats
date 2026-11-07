import { desc, eq, ne } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles, users } from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';
import { fssaiTierInfo, DAY } from '@/lib/fssai/tier';
import { lookupFssai } from '@/lib/fssai/lookup';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ app: fssaiApplications, user: users, profile: sellerProfiles })
    .from(fssaiApplications)
    .innerJoin(users, eq(fssaiApplications.sellerId, users.id))
    .leftJoin(sellerProfiles, eq(fssaiApplications.sellerId, sellerProfiles.userId))
    // 'draft' = a self-filed application the seller hasn't reported filing
    // yet — no back-office task exists for it, so it stays off this queue
    // until the seller shares a FoSCoS reference (DECISIONS.md #62+).
    .where(ne(fssaiApplications.status, 'draft'))
    .orderBy(desc(fssaiApplications.createdAt));
  const settings = await getPlatformSettings();
  const now = new Date();
  const opts = { deemedDays: settings.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: settings.provisionalMaxDays, now };
  const applications = await Promise.all(
    rows.map(async (r) => {
      const info = r.profile ? fssaiTierInfo(r.profile, r.app, opts) : null;
      const filedAt = r.app.filedAt;
      const windowEnds = filedAt ? new Date(filedAt.getTime() + settings.fssaiDeemedGrantDaysRegistration * DAY) : null;
      const interrupted = ['inspection_ordered', 'inadequacy_notice', 'rejected'].includes(r.app.status);
      return {
        ...r.app,
        sellerName: r.user.name,
        sellerPhone: r.user.phone,
        kitchenName: r.profile?.kitchenName ?? '',
        sellerId: r.app.sellerId,
        tier: info?.tier ?? 'none',
        tierReason: info?.reason ?? null,
        daysSinceApplication: Math.floor((now.getTime() - r.app.createdAt.getTime()) / DAY),
        daysSinceFiled: filedAt ? Math.floor((now.getTime() - filedAt.getTime()) / DAY) : null,
        deemedWindow: !filedAt ? 'not_filed' : interrupted ? 'interrupted' : now.getTime() <= windowEnds!.getTime() ? 'inside' : 'passed',
        deemedWindowEndsAt: windowEnds,
        blockedReason: r.profile?.fssaiBlockedReason ?? null,
        lookup: await lookupFssai(r.profile?.fssaiNumber, { kitchenName: r.profile?.kitchenName }),
        fssaiNumber: r.profile?.fssaiNumber ?? null,
      };
    }),
  );
  return ok({ applications });
});
