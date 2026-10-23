import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

type FulfillmentBody = {
  offersSelfPickup: boolean;
  offersSellerDelivery: boolean;
  sellerDeliveryFeeRupees: number;
  sellerDeliveryRadiusKm: number;
  pickupInstructions: string;
  tower?: string;
  maxOrdersPerSlot: number;
};

/** Seller's own fulfillment offer (DECISIONS.md #37+): self-pickup / seller-delivery toggles, fee, and slot cap. */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.userId, session.uid));
  if (!profile) throw new ApiError(404, 'Seller profile missing');
  return ok({
    offersSelfPickup: profile.offersSelfPickup,
    offersSellerDelivery: profile.offersSellerDelivery,
    sellerDeliveryFeeInPaise: profile.sellerDeliveryFeeInPaise,
    sellerDeliveryRadiusKm: profile.sellerDeliveryRadiusKm,
    pickupInstructions: profile.pickupInstructions,
    tower: profile.tower,
    maxOrdersPerSlot: profile.maxOrdersPerSlot,
  });
});

export const PATCH = api(async (req) => {
  const session = await requireSession(['seller']);
  const body = await readJson<FulfillmentBody>(req);
  if (!body.offersSelfPickup && !body.offersSellerDelivery) {
    throw new ApiError(400, 'Offer at least one fulfillment option');
  }
  if (body.offersSellerDelivery) {
    if (!(body.sellerDeliveryFeeRupees >= 0)) throw new ApiError(400, 'Delivery fee must be 0 or more');
    if (!(body.sellerDeliveryRadiusKm > 0)) throw new ApiError(400, 'Delivery radius must be more than 0 km');
  }
  if (!(body.maxOrdersPerSlot >= 1)) throw new ApiError(400, 'Orders per slot must be at least 1');

  const db = await getDb();
  const [updated] = await db
    .update(sellerProfiles)
    .set({
      offersSelfPickup: !!body.offersSelfPickup,
      offersSellerDelivery: !!body.offersSellerDelivery,
      sellerDeliveryFeeInPaise: Math.round((body.sellerDeliveryFeeRupees || 0) * 100),
      sellerDeliveryRadiusKm: body.sellerDeliveryRadiusKm || 5,
      pickupInstructions: body.pickupInstructions?.trim() || null,
      ...(body.tower !== undefined ? { tower: body.tower.trim().slice(0, 40) || null } : {}),
      maxOrdersPerSlot: Math.round(body.maxOrdersPerSlot),
    })
    .where(eq(sellerProfiles.userId, session.uid))
    .returning();
  if (!updated) throw new ApiError(404, 'Seller profile missing');
  return ok({
    offersSelfPickup: updated.offersSelfPickup,
    offersSellerDelivery: updated.offersSellerDelivery,
    sellerDeliveryFeeInPaise: updated.sellerDeliveryFeeInPaise,
    sellerDeliveryRadiusKm: updated.sellerDeliveryRadiusKm,
    pickupInstructions: updated.pickupInstructions,
    tower: updated.tower,
    maxOrdersPerSlot: updated.maxOrdersPerSlot,
  });
});
