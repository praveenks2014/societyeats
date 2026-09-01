import { desc, eq, inArray } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles, societies, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — item 3's "Verify licenses" tab:
 * every seller currently in 'awaiting_admin_check', with enough context for
 * a side-by-side identity check against the number they entered. sellerProfiles
 * has no free-text address column of its own, so "kitchen address" falls back
 * through the best available source: the seller's latest fssaiApplications
 * row (if one exists), then their self-pickup instructions, then their
 * society's address — never left entirely blank when any of those exist.
 */
export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ profile: sellerProfiles, user: users, society: societies })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(eq(sellerProfiles.fssaiStatus, 'awaiting_admin_check'));

  const sellerIds = rows.map((r) => r.profile.userId);
  const apps =
    sellerIds.length > 0
      ? await db
          .select()
          .from(fssaiApplications)
          .where(inArray(fssaiApplications.sellerId, sellerIds))
          .orderBy(desc(fssaiApplications.createdAt))
      : [];
  const latestAppBySeller = new Map<number, (typeof apps)[number]>();
  for (const a of apps) {
    if (!latestAppBySeller.has(a.sellerId)) latestAppBySeller.set(a.sellerId, a);
  }

  return ok({
    sellers: rows.map((r) => {
      const app = latestAppBySeller.get(r.profile.userId);
      return {
        userId: r.profile.userId,
        sellerName: r.user.name,
        sellerPhone: r.user.phone,
        kitchenName: r.profile.kitchenName,
        kitchenAddress: app?.kitchenAddress || r.profile.pickupInstructions || r.society?.addressText || null,
        fssaiNumber: r.profile.fssaiNumber,
        fssaiExpiry: r.profile.fssaiExpiry,
        fssaiCertificateUrl: r.profile.fssaiCertificateUrl,
        fssaiLicenseeName: r.profile.fssaiLicenseeName,
        fssaiLicenseeAddress: r.profile.fssaiLicenseeAddress,
        timelineJson: r.profile.fssaiVerificationTimelineJson ?? [],
      };
    }),
  });
});
