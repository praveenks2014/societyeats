import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { fssaiTier, tierBadge, type FssaiTier } from '@/lib/fssai/tier';

/** The kitchen's FSSAI tier and the buyer-facing label ("FSSAI registered · number" / "FSSAI applied: provisional"), for receipts and order pages. */
export async function sellerFssai(sellerId: number): Promise<{ tier: FssaiTier; number: string | null; label: string | null }> {
  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  if (!profile) return { tier: 'none', number: null, label: null };
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, sellerId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const s = await getPlatformSettings();
  const tier = fssaiTier(profile, app ?? null, { deemedDays: s.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: s.provisionalMaxDays });
  return { tier, number: profile.fssaiNumber ?? null, label: tierBadge(tier, profile.fssaiNumber)?.label ?? null };
}
