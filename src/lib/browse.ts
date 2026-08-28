import { and, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  fssaiApplications,
  listings,
  orders,
  reviews,
  sellerProfiles,
  societies,
  users,
} from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';
import { haversineKm, type GeoPoint } from '@/lib/geo';

export type ListingCard = {
  id: number;
  title: string;
  description: string | null;
  priceInPaise: number;
  isVeg: boolean;
  cuisine: string;
  photoUrl: string | null;
  prepTimeMins: number;
  availableQty: number;
  sellerId: number;
  kitchenName: string;
  vegOnly: boolean;
  rating: number;
  ratingCount: number;
  fssaiStatus: 'verified' | 'pending_application' | 'unverified';
  fssaiNumber: string | null;
  societyName: string | null;
  distanceKm: number | null;
};

/** Seller rows eligible to appear to buyers, with FSSAI-pending auto-pause applied. */
async function eligibleSellerFilter() {
  const db = await getDb();
  const settings = await getPlatformSettings();

  // pending kitchens past the grace window get their listings auto-paused
  const pending = await db
    .select({ userId: sellerProfiles.userId })
    .from(sellerProfiles)
    .where(eq(sellerProfiles.fssaiStatus, 'pending_application'));
  if (pending.length > 0) {
    const apps = await db
      .select()
      .from(fssaiApplications)
      .where(inArray(fssaiApplications.sellerId, pending.map((p) => p.userId)));
    const cutoffMs = settings.fssaiPendingMaxDays * 24 * 60 * 60 * 1000;
    for (const p of pending) {
      const app = apps
        .filter((a) => a.sellerId === p.userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const startedAt = app?.createdAt ?? new Date(0);
      if (Date.now() - startedAt.getTime() > cutoffMs) {
        await db
          .update(listings)
          .set({ isActive: false })
          .where(eq(listings.sellerId, p.userId));
      }
    }
  }
  return settings;
}

export async function browseListings(opts: {
  lat?: number;
  lng?: number;
  veg?: boolean;
  cuisine?: string;
  q?: string;
}): Promise<{ listings: ListingCard[]; cuisines: string[]; radiusKm: number }> {
  const db = await getDb();
  const settings = await eligibleSellerFilter();

  const rows = await db
    .select({
      listing: listings,
      profile: sellerProfiles,
      seller: users,
      society: societies,
    })
    .from(listings)
    .innerJoin(sellerProfiles, eq(listings.sellerId, sellerProfiles.userId))
    .innerJoin(users, eq(listings.sellerId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(
      and(
        eq(listings.isActive, true),
        gt(listings.availableQty, 0),
        eq(sellerProfiles.isApproved, true),
        ne(sellerProfiles.fssaiStatus, 'unverified'),
      ),
    );

  const q = opts.q?.trim().toLowerCase();
  const cards: ListingCard[] = [];
  const cuisines = new Set<string>();

  for (const { listing, profile, seller, society } of rows) {
    const sellerPoint: GeoPoint | null =
      seller.lat != null && seller.lng != null
        ? { lat: seller.lat, lng: seller.lng }
        : society
          ? { lat: society.lat, lng: society.lng }
          : null;

    let distanceKm: number | null = null;
    if (opts.lat != null && opts.lng != null && sellerPoint) {
      distanceKm = haversineKm({ lat: opts.lat, lng: opts.lng }, sellerPoint);
      if (distanceKm > settings.radiusKm) continue; // hard 10 km rule
    }

    cuisines.add(listing.cuisine);
    if (opts.veg && !listing.isVeg) continue;
    if (opts.cuisine && listing.cuisine !== opts.cuisine) continue;
    if (
      q &&
      ![listing.title, listing.description ?? '', profile.kitchenName, listing.cuisine]
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
      continue;

    cards.push({
      id: listing.id,
      title: listing.title,
      description: listing.description,
      priceInPaise: listing.priceInPaise,
      isVeg: listing.isVeg,
      cuisine: listing.cuisine,
      photoUrl: listing.photoUrl,
      prepTimeMins: listing.prepTimeMins,
      availableQty: listing.availableQty,
      sellerId: listing.sellerId,
      kitchenName: profile.kitchenName,
      vegOnly: profile.vegOnly,
      rating: profile.rating,
      ratingCount: profile.ratingCount,
      fssaiStatus: profile.fssaiStatus,
      fssaiNumber: profile.fssaiNumber,
      societyName: society?.name ?? null,
      distanceKm,
    });
  }

  cards.sort((a, b) => {
    if (a.distanceKm != null && b.distanceKm != null && a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    return b.rating - a.rating;
  });

  return { listings: cards, cuisines: [...cuisines].sort(), radiusKm: settings.radiusKm };
}

export async function getListingDetail(id: number, loc?: GeoPoint | null) {
  const db = await getDb();
  const [row] = await db
    .select({ listing: listings, profile: sellerProfiles, seller: users, society: societies })
    .from(listings)
    .innerJoin(sellerProfiles, eq(listings.sellerId, sellerProfiles.userId))
    .innerJoin(users, eq(listings.sellerId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(eq(listings.id, id));
  if (!row) return null;

  const sellerPoint: GeoPoint | null =
    row.seller.lat != null && row.seller.lng != null
      ? { lat: row.seller.lat, lng: row.seller.lng }
      : row.society
        ? { lat: row.society.lat, lng: row.society.lng }
        : null;
  const distanceKm =
    loc && sellerPoint ? haversineKm(loc, sellerPoint) : null;

  const sellerReviews = await db
    .select({ review: reviews, buyer: users })
    .from(reviews)
    .innerJoin(orders, eq(reviews.orderId, orders.id))
    .innerJoin(users, eq(reviews.buyerId, users.id))
    .where(eq(orders.sellerId, row.listing.sellerId))
    .orderBy(desc(reviews.createdAt))
    .limit(5);

  const otherDishes = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.sellerId, row.listing.sellerId),
        eq(listings.isActive, true),
        gt(listings.availableQty, 0),
        ne(listings.id, id),
      ),
    )
    .limit(6);

  return { ...row, distanceKm, sellerReviews, otherDishes };
}
