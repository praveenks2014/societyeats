import { and, desc, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
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
import { DEFAULTS } from '@/lib/config';
import { haversineKm, type GeoPoint } from '@/lib/geo';
import { neighbourOrderCount, sellerBadgeTier, sellerCompletedOrderCount } from '@/lib/reputation';
import { currentSlot, isSlotSoldOut, slotOrderCount } from '@/lib/slots';

const EARTH_RADIUS_KM = 6371; // matches src/lib/geo.ts's haversineKm exactly

/**
 * Great-circle distance (km) between (lat, lng) and a seller's effective
 * point, as a SQL fragment — the same haversine formula as geo.ts's
 * haversineKm(), translated to SQL so it can run inside the WHERE clause
 * (filtered + indexed in Postgres) instead of over every row in JS.
 */
function haversineKmSql(lat: number, lng: number, latExpr: SQL, lngExpr: SQL): SQL<number> {
  return sql<number>`(
    2 * ${EARTH_RADIUS_KM} * asin(sqrt(
      power(sin(radians(${lat} - ${latExpr}) / 2), 2) +
      cos(radians(${latExpr})) * cos(radians(${lat})) *
      power(sin(radians(${lng} - ${lngExpr}) / 2), 2)
    ))
  )`;
}

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
  /** DECISIONS.md #37+: this listing's seller has hit maxOrdersPerSlot for the current meal slot. */
  slotSoldOut: boolean;
  /** DECISIONS.md #73+: kitchenPhotosJson has at least DEFAULTS.minKitchenPhotosRequired entries. */
  kitchenPhotosVerified: boolean;
  /** DECISIONS.md #73+: distinct buyers with a completed order from this seller — "Ordered by N neighbours". */
  orderedByCount: number;
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

  // Effective seller point: their own lat/lng if set, else their society's —
  // same fallback the buyer-facing distance always used, now computed once
  // in SQL and reused for both the filter and the displayed distance.
  const effLat = sql`coalesce(${users.lat}, ${societies.lat})`;
  const effLng = sql`coalesce(${users.lng}, ${societies.lng})`;
  const hasLoc = opts.lat != null && opts.lng != null;
  const distanceExpr = hasLoc ? haversineKmSql(opts.lat!, opts.lng!, effLat, effLng) : null;

  const conditions = [
    eq(listings.isActive, true),
    gt(listings.availableQty, 0),
    eq(sellerProfiles.isApproved, true),
    ne(sellerProfiles.fssaiStatus, 'unverified'),
  ];
  if (distanceExpr) {
    // Hard 10 km rule, enforced in SQL against indexed lat/lng columns
    // (users_lat_lng_idx / societies_lat_lng_idx). Sellers with no
    // coordinates at all (no direct lat/lng and no society) can't be
    // distance-checked, so a location-scoped browse excludes them rather
    // than showing them at an unknown distance.
    conditions.push(
      sql`${effLat} is not null and ${effLng} is not null and ${distanceExpr} <= ${settings.radiusKm}`,
    );
  }

  const rows = await db
    .select({
      listing: listings,
      profile: sellerProfiles,
      society: societies,
      distanceKm: distanceExpr ?? sql<number | null>`null`,
    })
    .from(listings)
    .innerJoin(sellerProfiles, eq(listings.sellerId, sellerProfiles.userId))
    .innerJoin(users, eq(listings.sellerId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(and(...conditions));

  const q = opts.q?.trim().toLowerCase();
  const cards: ListingCard[] = [];
  const cuisines = new Set<string>();

  // Slot-capacity cache: one order-count query per seller per browse call,
  // not per listing (a seller may list several dishes for the same slot).
  const slot = currentSlot();
  const slotFullBySeller = new Map<number, boolean>();
  async function sellerSlotFull(sellerId: number, maxOrdersPerSlot: number): Promise<boolean> {
    if (!slot) return false;
    const cached = slotFullBySeller.get(sellerId);
    if (cached !== undefined) return cached;
    const count = await slotOrderCount(sellerId, slot);
    const full = count >= maxOrdersPerSlot;
    slotFullBySeller.set(sellerId, full);
    return full;
  }

  // Same per-seller caching approach for "Ordered by N neighbours" (DECISIONS.md #73+).
  const neighbourCountBySeller = new Map<number, number>();
  async function sellerNeighbourCount(sellerId: number): Promise<number> {
    const cached = neighbourCountBySeller.get(sellerId);
    if (cached !== undefined) return cached;
    const count = await neighbourOrderCount(sellerId);
    neighbourCountBySeller.set(sellerId, count);
    return count;
  }

  for (const { listing, profile, society, distanceKm } of rows) {
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

    const listingSlots = listing.slotsJson?.slots;
    const slotSoldOut =
      slot && (!listingSlots || listingSlots.length === 0 || listingSlots.includes(slot))
        ? await sellerSlotFull(listing.sellerId, profile.maxOrdersPerSlot)
        : false;

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
      distanceKm: distanceKm != null ? Number(distanceKm) : null,
      slotSoldOut,
      kitchenPhotosVerified: (profile.kitchenPhotosJson?.length ?? 0) >= DEFAULTS.minKitchenPhotosRequired,
      orderedByCount: await sellerNeighbourCount(listing.sellerId),
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

  const slotSoldOut = await isSlotSoldOut(
    row.listing.sellerId,
    row.profile.maxOrdersPerSlot,
    row.listing.slotsJson?.slots,
  );
  const orderedByCount = await neighbourOrderCount(row.listing.sellerId);
  const completedOrderCount = await sellerCompletedOrderCount(row.listing.sellerId);

  return {
    ...row,
    distanceKm,
    sellerReviews,
    otherDishes,
    slotSoldOut,
    orderedByCount,
    completedOrderCount,
    badgeTier: sellerBadgeTier(completedOrderCount),
  };
}

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). The public kitchen/seller profile page's data — everything
 * getListingDetail() already assembles for a single dish's "kitchen card",
 * but keyed by seller instead of by one dish, plus the order-count badge
 * tier. Deliberately does NOT gate on isApproved/fssaiStatus the way
 * browseListings() does — same reasoning as getListingDetail() never
 * re-checking those either: a direct link should resolve to whatever the
 * seller's real current state is, with eligibility enforced separately at
 * browse-time and order-time, not by 404-ing a shared link.
 */
export async function getKitchenProfile(sellerId: number) {
  const db = await getDb();
  const [row] = await db
    .select({ profile: sellerProfiles, seller: users, society: societies })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(eq(sellerProfiles.userId, sellerId));
  if (!row) return null;

  const activeListings = await db
    .select()
    .from(listings)
    .where(
      and(eq(listings.sellerId, sellerId), eq(listings.isActive, true), gt(listings.availableQty, 0)),
    )
    .orderBy(desc(listings.id));

  const sellerReviews = await db
    .select({ review: reviews, buyer: users })
    .from(reviews)
    .innerJoin(orders, eq(reviews.orderId, orders.id))
    .innerJoin(users, eq(reviews.buyerId, users.id))
    .where(eq(orders.sellerId, sellerId))
    .orderBy(desc(reviews.createdAt))
    .limit(10);

  const [orderedByCount, completedOrderCount, settings] = await Promise.all([
    neighbourOrderCount(sellerId),
    sellerCompletedOrderCount(sellerId),
    getPlatformSettings(),
  ]);

  return {
    ...row,
    activeListings,
    sellerReviews,
    orderedByCount,
    completedOrderCount,
    badgeTier: sellerBadgeTier(completedOrderCount),
    isFeatured: settings.featuredSellerId === String(sellerId),
  };
}

/**
 * "Neighbour's kitchen of the week" — admin-pickable via
 * platform_config.featuredSellerId (PATCH /api/admin/sellers, action
 * 'feature'). Returns null when unset, the seller no longer exists, or the
 * seller has no dishes currently on sale (nothing to actually showcase).
 */
export async function getFeaturedKitchen() {
  const settings = await getPlatformSettings();
  const sellerId = Number(settings.featuredSellerId);
  if (!settings.featuredSellerId || !Number.isFinite(sellerId)) return null;
  const profile = await getKitchenProfile(sellerId);
  if (!profile || profile.activeListings.length === 0) return null;
  return profile;
}
