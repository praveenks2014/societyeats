import { and, desc, eq, gt, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
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
import { fssaiFiledEligible, isFssaiEligibleToPublish } from '@/lib/fssai/gate';
import { neighbourOrderCount, sellerBadgeTier, sellerCompletedOrderCount } from '@/lib/reputation';
import { kitchenGate } from '@/lib/kitchen/gate';
import { buyerHandle } from '@/lib/handles';
import { currentSlot, isSlotSoldOut, slotOrderCount } from '@/lib/slots';

/**
 * FSSAI hardening v3 (DECISIONS.md #119+): each seller's own most recent
 * fssaiApplications row, batch-fetched once per distinct seller in a
 * result set (never per-listing) — same "fetch once, reduce in JS" pattern
 * this file already uses for slot capacity / neighbour counts below.
 * `orderBy(desc(createdAt))` over ALL matching sellers, reduced to the
 * first (newest) row per sellerId in JS — cheap at pilot scale (a handful
 * of applications per seller, a handful of sellers).
 */
async function latestApplicationsBySeller(
  sellerIds: number[],
): Promise<Map<number, typeof fssaiApplications.$inferSelect>> {
  const map = new Map<number, typeof fssaiApplications.$inferSelect>();
  if (sellerIds.length === 0) return map;
  const db = await getDb();
  const rows = await db
    .select()
    .from(fssaiApplications)
    .where(inArray(fssaiApplications.sellerId, sellerIds))
    .orderBy(desc(fssaiApplications.createdAt));
  for (const row of rows) {
    if (!map.has(row.sellerId)) map.set(row.sellerId, row);
  }
  return map;
}

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
  fssaiStatus: 'verified' | 'pending_application' | 'unverified' | 'awaiting_admin_check';
  fssaiNumber: string | null;
  /** FSSAI hardening v3 (DECISIONS.md #119+): see FssaiBadgeInput's own doc comment. */
  eligibleFoscosRef: string | null;
  societyName: string | null;
  distanceKm: number | null;
  /** DECISIONS.md #37+: this listing's seller has hit maxOrdersPerSlot for the current meal slot. */
  slotSoldOut: boolean;
  /** DECISIONS.md #73+: kitchenPhotosJson has at least DEFAULTS.minKitchenPhotosRequired entries. */
  kitchenPhotosVerified: boolean;
  /** DECISIONS.md #73+: distinct buyers with a completed order from this seller — "Ordered by N neighbours". */
  orderedByCount: number;
};

export async function browseListings(opts: {
  lat?: number;
  lng?: number;
  veg?: boolean;
  cuisine?: string;
  q?: string;
  /** Restrict to kitchens inside this society ("My society"); omit for "Nearby" (radius). */
  societyId?: number;
}): Promise<{ listings: ListingCard[]; cuisines: string[]; radiusKm: number }> {
  const db = await getDb();
  const settings = await getPlatformSettings();

  // Effective seller point: their own lat/lng if set, else their society's —
  // same fallback the buyer-facing distance always used, now computed once
  // in SQL and reused for both the filter and the displayed distance.
  const effLat = sql`coalesce(${users.lat}, ${societies.lat})`;
  const effLng = sql`coalesce(${users.lng}, ${societies.lng})`;
  const hasLoc = opts.lat != null && opts.lng != null;
  const distanceExpr = hasLoc ? haversineKmSql(opts.lat!, opts.lng!, effLat, effLng) : null;

  // FSSAI hardening v3 (DECISIONS.md #119+): the old SQL `ne(fssaiStatus,
  // 'unverified')` filter (plus the fssaiPendingMaxDays auto-pause that used
  // to keep it honest — deleted, see src/lib/seller.ts) is replaced by the
  // real publishing-eligibility check below, applied per-row in JS once
  // each seller's latest application is known (SQL can't express the
  // deemed-commencement date math against a joined application row cheaply,
  // and this file already reduces several other per-seller signals in JS —
  // see the slot/neighbour-count caches further down).
  // Phase 1 Pilot: a dish is buyer-visible only when the admin approved the
  // kitchen AND the dish, the kitchen's subscription is active/waived/in grace,
  // the account isn't blocked and the society is active. (The FSSAI gate is
  // applied per-row below, then re-checked when an order is placed.)
  const conditions = [
    eq(listings.isActive, true),
    gt(listings.availableQty, 0),
    eq(sellerProfiles.isApproved, true),
    eq(listings.moderationStatus, 'approved'),
    isNull(users.blockedAt),
    sql`(${societies.id} is null or ${societies.isActive})`,
    sql`exists (
      select 1 from kitchen_subscriptions ks
      where ks.seller_id = ${listings.sellerId}
        and ks.status in ('active', 'grace', 'waived')
        and ks.starts_at <= now()
        and ks.ends_at + (${settings.subscriptionGraceDays} * interval '1 day') > now()
    )`,
  ];
  if (opts.societyId) conditions.push(eq(users.societyId, opts.societyId));
  if (distanceExpr && !opts.societyId) {
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

  // FSSAI hardening v3 (DECISIONS.md #119+) — one batched fetch for every
  // distinct seller in `rows`, not per-listing (a seller may list several
  // dishes). See isFssaiEligibleToPublish's own doc comment: eligibility
  // never depends on `profile.fssaiStatus` alone.
  const applicationBySeller = await latestApplicationsBySeller([...new Set(rows.map((r) => r.listing.sellerId))]);

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

    const latestApplication = applicationBySeller.get(listing.sellerId) ?? null;
    if (!isFssaiEligibleToPublish(profile, latestApplication)) continue;

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
      eligibleFoscosRef: fssaiFiledEligible(latestApplication) ? latestApplication!.foscosRefNumber : null,
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

  const sellerReviewRows = await db
    .select({ review: reviews, buyer: users })
    .from(reviews)
    .innerJoin(orders, eq(reviews.orderId, orders.id))
    .innerJoin(users, eq(reviews.buyerId, users.id))
    .where(eq(orders.sellerId, row.listing.sellerId))
    .orderBy(desc(reviews.createdAt))
    .limit(5);
  // Appreciation notes are shown anonymised ("Buyer #A7") — never a real name.
  const sellerReviews = sellerReviewRows.map((r) => ({ ...r, buyer: { ...r.buyer, name: buyerHandle(r.review.orderId, r.review.buyerId), phone: '' } }));

  const otherDishes = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.sellerId, row.listing.sellerId),
        eq(listings.isActive, true),
        eq(listings.moderationStatus, 'approved'),
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
  // FSSAI hardening v3 (DECISIONS.md #119+) — see the badge doc comment on
  // ListingCard above; a single-seller lookup here, not the batched one
  // browseListings() uses (this function only ever looks at one seller).
  const latestApplication = (await latestApplicationsBySeller([row.listing.sellerId])).get(row.listing.sellerId) ?? null;

  const gate = await kitchenGate(row.listing.sellerId);

  return {
    ...row,
    /** False when the kitchen/dish is not currently orderable (shown as "unavailable"). */
    listable: gate.ok && row.listing.moderationStatus === 'approved' && row.listing.isActive,
    distanceKm,
    sellerReviews,
    otherDishes,
    slotSoldOut,
    orderedByCount,
    completedOrderCount,
    badgeTier: sellerBadgeTier(completedOrderCount),
    eligibleFoscosRef: fssaiFiledEligible(latestApplication) ? latestApplication!.foscosRefNumber : null,
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
      and(
        eq(listings.sellerId, sellerId),
        eq(listings.isActive, true),
        eq(listings.moderationStatus, 'approved'),
        gt(listings.availableQty, 0),
      ),
    )
    .orderBy(desc(listings.id));

  const sellerReviewRows = await db
    .select({ review: reviews, buyer: users })
    .from(reviews)
    .innerJoin(orders, eq(reviews.orderId, orders.id))
    .innerJoin(users, eq(reviews.buyerId, users.id))
    .where(eq(orders.sellerId, sellerId))
    .orderBy(desc(reviews.createdAt))
    .limit(10);
  const sellerReviews = sellerReviewRows.map((r) => ({ ...r, buyer: { ...r.buyer, name: buyerHandle(r.review.orderId, r.review.buyerId), phone: '' } }));

  const [orderedByCount, completedOrderCount, settings, applicationBySeller] = await Promise.all([
    neighbourOrderCount(sellerId),
    sellerCompletedOrderCount(sellerId),
    getPlatformSettings(),
    latestApplicationsBySeller([sellerId]),
  ]);
  const latestApplication = applicationBySeller.get(sellerId) ?? null;

  const gate = await kitchenGate(sellerId);

  return {
    ...row,
    kitchenLive: gate.ok,
    activeListings: gate.ok ? activeListings : [],
    activeListingsHidden: !gate.ok,
    sellerReviews,
    orderedByCount,
    completedOrderCount,
    badgeTier: sellerBadgeTier(completedOrderCount),
    isFeatured: settings.featuredSellerId === String(sellerId),
    // FSSAI hardening v3 (DECISIONS.md #119+) — see ListingCard's own doc comment.
    eligibleFoscosRef: fssaiFiledEligible(latestApplication) ? latestApplication!.foscosRefNumber : null,
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
