import { eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { getDb } from '@/lib/db';
import { sellerProfiles, societies, users } from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';
import { haversineKm } from '@/lib/geo';
import { getSession } from '@/lib/auth';
import { feeConfigFromSettings } from '@/lib/money';
import { availableCreditPaise as availableCreditPaiseFor } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

/**
 * Pre-checkout fulfillment preview for a seller (DECISIONS.md #37+): what
 * they offer (self-pickup / seller-delivery / platform-delivery-if-enabled),
 * plus a live distance + delivery quote once the buyer has a location. lat/lng
 * are optional so the checkout chooser can render self-pickup copy — the
 * default, no address needed — before any location is known.
 */
export const GET = api(async (req) => {
  const sp = req.nextUrl.searchParams;
  const sellerId = Number(sp.get('sellerId'));
  if (!sellerId) throw new ApiError(400, 'sellerId required');
  const latParam = sp.get('lat');
  const lngParam = sp.get('lng');
  const lat = latParam != null ? Number(latParam) : null;
  const lng = lngParam != null ? Number(lngParam) : null;
  const hasLoc = lat != null && Number.isFinite(lat) && lng != null && Number.isFinite(lng);

  const db = await getDb();
  const settings = await getPlatformSettings();
  const session = await getSession();
  const availableCreditPaise = session ? await availableCreditPaiseFor(session.uid) : 0;
  const [seller] = await db.select().from(users).where(eq(users.id, sellerId));
  if (!seller) throw new ApiError(404, 'Kitchen not found');
  const [profile] = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.userId, sellerId));
  if (!profile) throw new ApiError(404, 'Kitchen not found');

  let point = seller.lat != null && seller.lng != null ? { lat: seller.lat, lng: seller.lng } : null;
  if (!point && seller.societyId) {
    const [soc] = await db.select().from(societies).where(eq(societies.id, seller.societyId));
    if (soc) point = { lat: soc.lat, lng: soc.lng };
  }

  const base = {
    sellerId,
    kitchenName: profile.kitchenName,
    pickupInstructions: profile.pickupInstructions,
    offersSelfPickup: profile.offersSelfPickup,
    offersSellerDelivery: profile.offersSellerDelivery,
    sellerDeliveryFeeInPaise: profile.sellerDeliveryFeeInPaise,
    sellerDeliveryRadiusKm: profile.sellerDeliveryRadiusKm,
    platformDeliveryEnabled: false, // not available while the platform holds no payment-aggregator licence
    // The bill is two parts: food (paid to the kitchen) + platform fee (Razorpay).
    // The fee maths lives in src/lib/money/fees.ts and is shared with the server.
    feeConfig: feeConfigFromSettings(settings),
    acceptsUpiNow: profile.acceptsUpiNow,
    acceptsPayAtPickup: profile.acceptsPayAtPickup,
    radiusKm: settings.radiusKm,
    availableCreditPaise,
  };

  // No location yet, or the kitchen has no resolvable point: fulfillment
  // offer flags are still useful (self-pickup copy needs none of this),
  // but every distance-derived field comes back null.
  if (!hasLoc || !point) {
    return ok({
      ...base,
      distanceKm: null,
      withinRange: null,
      sellerDeliveryAvailable: null,
      platformDeliveryFeeInPaise: null,
      platformDeliveryEtaMins: null,
    });
  }

  const distanceKm = haversineKm({ lat: lat!, lng: lng! }, point);
  const withinRange = distanceKm <= settings.radiusKm;
  if (!withinRange) {
    return ok({
      ...base,
      distanceKm,
      withinRange,
      sellerDeliveryAvailable: false,
      platformDeliveryFeeInPaise: null,
      platformDeliveryEtaMins: null,
    });
  }

  const sellerDeliveryAvailable =
    profile.offersSellerDelivery && distanceKm <= profile.sellerDeliveryRadiusKm;
  // Only ask the orchestrator for a live/mock quote when the option is
  // actually enabled — it's an overflow path, not the default.
  const quote = null as { amountInPaise: number; etaMins: number } | null;

  return ok({
    ...base,
    distanceKm,
    withinRange,
    sellerDeliveryAvailable,
    platformDeliveryFeeInPaise: quote?.amountInPaise ?? null,
    platformDeliveryEtaMins: quote?.etaMins ?? null,
  });
});
