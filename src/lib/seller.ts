import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';

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

/** Compliance gate: no publishing without FSSAI (verified or pending) + admin approval. */
export async function assertCanPublish(sellerId: number) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.userId, sellerId));
  if (!profile) throw new ApiError(404, 'Seller profile missing');
  if (profile.fssaiStatus === 'unverified') {
    throw new ApiError(403, 'Add your FSSAI license (or start an application) in Compliance before publishing dishes');
  }
  if (!profile.isApproved) {
    throw new ApiError(403, 'Your kitchen is awaiting GharSe approval — you can save drafts meanwhile');
  }
}
