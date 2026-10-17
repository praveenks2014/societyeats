import { desc, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { isFssaiEligibleToPublish } from '@/lib/fssai/gate';

export type ListingBody = {
  title: string;
  description?: string;
  priceRupees: number;
  isVeg: boolean;
  cuisine: string;
  photoUrl?: string;
  prepTimeMins: number;
  availableQty: number;
  days: string[];
  slots: string[];
  isActive?: boolean;
};

/**
 * Compliance gate: no publishing without FSSAI verified, or a FoSCoS filing
 * old enough to be deemed-eligible under the regulation (see
 * src/lib/fssai/gate.ts), plus admin approval. FSSAI hardening v3
 * (DECISIONS.md #119+) replaces the old fssaiPendingMaxDays grace-window
 * check entirely — see also src/lib/browse.ts, which dropped the auto-pause
 * mechanism this gate superseded.
 */
export async function assertCanPublish(sellerId: number) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.userId, sellerId));
  if (!profile) throw new ApiError(404, 'Seller profile missing');

  const [latestApplication] = await db
    .select()
    .from(fssaiApplications)
    .where(eq(fssaiApplications.sellerId, sellerId))
    .orderBy(desc(fssaiApplications.createdAt))
    .limit(1);

  if (!isFssaiEligibleToPublish(profile, latestApplication ?? null)) {
    throw new ApiError(
      403,
      'Add your FSSAI license, or file an application on FoSCoS yourself, in Compliance before publishing dishes',
    );
  }
  if (!profile.isApproved) {
    throw new ApiError(403, 'Your kitchen is awaiting PadosiPlate approval — you can save drafts meanwhile');
  }
}
