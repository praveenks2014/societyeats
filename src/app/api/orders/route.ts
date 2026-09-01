import { and, desc, eq, inArray } from 'drizzle-orm';
import { api, ApiError, ok, otp4, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  listings,
  malls,
  orderEvents,
  orderItems,
  orders,
  restaurantItems,
  restaurants,
  sellerProfiles,
  societies,
  users,
  type DeliveryAddress,
} from '@/lib/db/schema';
import { DEFAULTS, isMockMode } from '@/lib/config';
import { getPlatformSettings } from '@/lib/db/platform';
import { getBestQuote } from '@/lib/delivery/orchestrator';
import { haversineKm, type GeoPoint } from '@/lib/geo';
import { formatINR, pctOf } from '@/lib/money';
import { createPaymentForOrder } from '@/lib/payments';
import { rateLimit } from '@/lib/rate-limit';
import { currentSlot, isSlotSoldOut } from '@/lib/slots';
import { applyCredit, availableCreditPaise } from '@/lib/referrals';

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+): caps how much referral credit a single order can absorb, so the
 * payable amount never hits ₹0 (a real payment gateway needs a positive
 * amount, and mock mode should mirror that constraint rather than special-case it).
 */
const MIN_PAYABLE_PAISE = 100;

/** Never trusts a client-supplied amount — recomputes from the buyer's real balance. */
async function creditToApply(buyerId: number, useCredit: boolean | undefined, totalBeforeCredit: number): Promise<number> {
  if (!useCredit) return 0;
  const available = await availableCreditPaise(buyerId);
  const maxApplicable = Math.max(0, totalBeforeCredit - MIN_PAYABLE_PAISE);
  return Math.min(available, maxApplicable);
}

export const dynamic = 'force-dynamic';

type FulfillmentType = 'self_pickup' | 'seller_delivery' | 'platform_delivery';
const FULFILLMENT_TYPES: FulfillmentType[] = ['self_pickup', 'seller_delivery', 'platform_delivery'];

type CreateBody = {
  type: 'home_delivery' | 'mall_pickup';
  sellerId?: number;
  restaurantId?: number;
  items: { id: number; qty: number }[];
  address?: DeliveryAddress;
  fulfillmentType?: FulfillmentType;
  /** Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+): apply available referral credit, if any. */
  useCredit?: boolean;
};

export const POST = api(async (req) => {
  const session = await requireSession();
  // keyed by account, not IP: a whole society can sit behind one shared
  // NAT gateway, so IP-based limiting here would punish neighbours together
  rateLimit(`orders:create:${session.uid}`, { limit: 20, windowMs: 5 * 60 * 1000 });
  const body = await readJson<CreateBody>(req);
  if (!body.items?.length) throw new ApiError(400, 'Cart is empty');
  const db = await getDb();
  const settings = await getPlatformSettings();

  // Pilot Hardening v2 — Phase 4 (DECISIONS.md #62+): GharSe itself needs a
  // Central FSSAI e-commerce license before real (non-mock) orders can be
  // taken. MOCK_MODE keeps every integration — including this gate — dormant
  // in demo/dev; it only bites once someone actually flips MOCK_MODE=false.
  if (!isMockMode() && !settings.platformFssaiCentralLicenseNo) {
    throw new ApiError(
      503,
      'Live orders are paused — the platform FSSAI Central License has not been entered yet. Contact support.',
    );
  }

  if (body.type === 'home_delivery') {
    if (!body.sellerId) throw new ApiError(400, 'Missing seller');
    const fulfillmentType: FulfillmentType = body.fulfillmentType ?? 'self_pickup';
    if (!FULFILLMENT_TYPES.includes(fulfillmentType)) {
      throw new ApiError(400, 'Invalid fulfillment type');
    }
    const needsAddress = fulfillmentType !== 'self_pickup';

    const [profile] = await db
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, body.sellerId));
    if (!profile?.isApproved || profile.fssaiStatus === 'unverified') {
      throw new ApiError(400, 'This kitchen is not accepting orders right now');
    }
    if (fulfillmentType === 'self_pickup' && !profile.offersSelfPickup) {
      throw new ApiError(400, 'This kitchen does not offer self-pickup');
    }
    if (fulfillmentType === 'seller_delivery' && !profile.offersSellerDelivery) {
      throw new ApiError(400, 'This kitchen does not offer its own delivery');
    }
    if (fulfillmentType === 'platform_delivery' && !settings.platformDeliveryEnabled) {
      throw new ApiError(400, 'Delivery partner pickup is not available right now');
    }

    let addr: DeliveryAddress | null = null;
    let sellerPoint: GeoPoint | null = null;
    let distance = 0;
    if (needsAddress) {
      if (!body.address) throw new ApiError(400, 'Missing delivery address');
      addr = body.address;
      if (typeof addr.lat !== 'number' || typeof addr.lng !== 'number' || !addr.flat?.trim()) {
        throw new ApiError(400, 'Delivery address is incomplete');
      }
      const [seller] = await db.select().from(users).where(eq(users.id, body.sellerId));
      sellerPoint =
        seller?.lat != null && seller?.lng != null ? { lat: seller.lat, lng: seller.lng } : null;
      if (!sellerPoint && seller?.societyId) {
        const [soc] = await db.select().from(societies).where(eq(societies.id, seller.societyId));
        if (soc) sellerPoint = { lat: soc.lat, lng: soc.lng };
      }
      if (!sellerPoint) throw new ApiError(400, 'Kitchen location unavailable');

      distance = haversineKm({ lat: addr.lat, lng: addr.lng }, sellerPoint);
      if (distance > settings.radiusKm) {
        throw new ApiError(400, `This kitchen is ${distance.toFixed(1)} km away — outside the ${settings.radiusKm} km delivery radius`);
      }
      if (fulfillmentType === 'seller_delivery' && distance > profile.sellerDeliveryRadiusKm) {
        throw new ApiError(
          400,
          `This kitchen only delivers within ${profile.sellerDeliveryRadiusKm} km — you're ${distance.toFixed(1)} km away. Try self-pickup instead.`,
        );
      }
    }

    const rows = await db
      .select()
      .from(listings)
      .where(inArray(listings.id, body.items.map((i) => i.id)));
    let subtotal = 0;
    const itemRows: (typeof orderItems.$inferInsert)[] = [];
    for (const item of body.items) {
      const listing = rows.find((l) => l.id === item.id);
      if (!listing || !listing.isActive || listing.sellerId !== body.sellerId) {
        throw new ApiError(400, 'An item in your cart is no longer available');
      }
      const qty = Math.max(1, Math.min(item.qty, listing.availableQty));
      if (listing.availableQty < item.qty) {
        throw new ApiError(400, `Only ${listing.availableQty} of "${listing.title}" left`);
      }
      subtotal += qty * listing.priceInPaise;
      itemRows.push({
        orderId: 0,
        listingId: listing.id,
        titleSnapshot: listing.title,
        qty,
        unitPriceInPaise: listing.priceInPaise,
      });
    }

    if (fulfillmentType === 'platform_delivery' && subtotal < settings.platformDeliveryMinOrderPaise) {
      throw new ApiError(
        400,
        `Delivery partner pickup needs an order of ${formatINR(settings.platformDeliveryMinOrderPaise)} or more — try self-pickup or seller delivery.`,
      );
    }

    // Seller-level slot capacity (DECISIONS.md #37+): a cap on in-flight
    // orders per meal slot, independent of any single dish's availableQty.
    const slot = currentSlot();
    const cartSlots = rows.flatMap((l) => l.slotsJson?.slots ?? []);
    if (slot && (cartSlots.length === 0 || cartSlots.includes(slot))) {
      const soldOut = await isSlotSoldOut(body.sellerId, profile.maxOrdersPerSlot, cartSlots);
      if (soldOut) {
        throw new ApiError(400, 'This kitchen is sold out for the current meal slot — try again next slot');
      }
    }

    let deliveryFeeInPaise = 0;
    if (fulfillmentType === 'seller_delivery') {
      deliveryFeeInPaise = profile.sellerDeliveryFeeInPaise;
    } else if (fulfillmentType === 'platform_delivery') {
      const quote = await getBestQuote(sellerPoint!, { lat: addr!.lat, lng: addr!.lng });
      deliveryFeeInPaise = quote.amountInPaise;
    }

    // Commission is on the item subtotal only — seller delivery fees are the
    // seller's own money, never platform revenue (DECISIONS.md founder spec).
    const commission = pctOf(subtotal, settings.commissionHomePct);
    // GST 5% on home-food orders: GharSe is the deemed supplier under Sec
    // 9(5) CGST, so this is collected and remitted by the platform, not the cook.
    const gstInPaise = pctOf(subtotal, DEFAULTS.gstPct);
    const totalBeforeCredit = subtotal + deliveryFeeInPaise + settings.platformFeePaise + gstInPaise;
    const creditApplied = await creditToApply(session.uid, body.useCredit, totalBeforeCredit);
    const total = totalBeforeCredit - creditApplied;

    const [order] = await db
      .insert(orders)
      .values({
        buyerId: session.uid,
        type: 'home_delivery',
        sellerId: body.sellerId,
        status: 'placed',
        fulfillmentType,
        subtotalInPaise: subtotal,
        deliveryFeeInPaise,
        platformFeeInPaise: settings.platformFeePaise,
        commissionInPaise: commission,
        gstInPaise,
        referralCreditAppliedInPaise: creditApplied,
        totalInPaise: total,
        deliveryAddressJson: addr,
        otpCode: otp4(),
      })
      .returning();
    await db.insert(orderItems).values(itemRows.map((r) => ({ ...r, orderId: order.id })));
    await db.insert(orderEvents).values({ orderId: order.id, status: 'placed', note: 'Order placed' });
    if (creditApplied > 0) await applyCredit(session.uid, order.id, creditApplied);

    const payment = await createPaymentForOrder(order.id, total);
    return ok({ orderId: order.id, totalInPaise: total, payment });
  }

  // ---- mall pickup ----
  // Pilot Hardening v2 — Phase 8 (DECISIONS.md #112+): Mall Mode is deferred
  // this pilot. The buyer-facing storefront already 404s while the flag is
  // off (src/app/m/[mallSlug]/page.tsx), so this is defense-in-depth against
  // a direct API call rather than the primary gate.
  if (!settings.mallModeEnabled) {
    throw new ApiError(503, 'Mall Mode is not available during this pilot');
  }
  if (!body.restaurantId) throw new ApiError(400, 'Missing restaurant');
  const [restaurant] = await db
    .select({ restaurant: restaurants, mall: malls })
    .from(restaurants)
    .innerJoin(malls, eq(restaurants.mallId, malls.id))
    .where(eq(restaurants.id, body.restaurantId));
  if (!restaurant) throw new ApiError(404, 'Restaurant not found');

  const rows = await db
    .select()
    .from(restaurantItems)
    .where(inArray(restaurantItems.id, body.items.map((i) => i.id)));
  let subtotal = 0;
  const itemRows: (typeof orderItems.$inferInsert)[] = [];
  for (const item of body.items) {
    const ri = rows.find((r) => r.id === item.id);
    if (!ri || !ri.isActive || ri.restaurantId !== body.restaurantId) {
      throw new ApiError(400, 'An item in your cart is no longer available');
    }
    if (ri.stockQty < item.qty) throw new ApiError(400, `Only ${ri.stockQty} of "${ri.title}" left`);
    subtotal += item.qty * ri.priceInPaise;
    itemRows.push({
      orderId: 0,
      restaurantItemId: ri.id,
      titleSnapshot: ri.title,
      qty: item.qty,
      unitPriceInPaise: ri.priceInPaise,
    });
  }

  const commission = pctOf(subtotal, settings.commissionMallPct);
  const totalBeforeCredit = subtotal + settings.platformFeePaise;
  const creditApplied = await creditToApply(session.uid, body.useCredit, totalBeforeCredit);
  const total = totalBeforeCredit - creditApplied;
  const [order] = await db
    .insert(orders)
    .values({
      buyerId: session.uid,
      type: 'mall_pickup',
      restaurantId: body.restaurantId,
      status: 'placed',
      subtotalInPaise: subtotal,
      deliveryFeeInPaise: 0,
      platformFeeInPaise: settings.platformFeePaise,
      commissionInPaise: commission,
      referralCreditAppliedInPaise: creditApplied,
      totalInPaise: total,
      otpCode: otp4(),
    })
    .returning();
  await db.insert(orderItems).values(itemRows.map((r) => ({ ...r, orderId: order.id })));
  await db.insert(orderEvents).values({ orderId: order.id, status: 'placed', note: 'Order placed' });
  if (creditApplied > 0) await applyCredit(session.uid, order.id, creditApplied);

  const payment = await createPaymentForOrder(order.id, total);
  return ok({ orderId: order.id, totalInPaise: total, payment });
});

export const GET = api(async () => {
  const session = await requireSession();
  const db = await getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.buyerId, session.uid))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];

  const sellerIds = rows.map((r) => r.sellerId).filter((x): x is number => x != null);
  const profiles = sellerIds.length
    ? await db.select().from(sellerProfiles).where(inArray(sellerProfiles.userId, sellerIds))
    : [];
  const restIds = rows.map((r) => r.restaurantId).filter((x): x is number => x != null);
  const rests = restIds.length
    ? await db.select().from(restaurants).where(inArray(restaurants.id, restIds))
    : [];

  return ok({
    orders: rows.map((o) => ({
      ...o,
      items: items.filter((i) => i.orderId === o.id),
      vendorName:
        (o.sellerId && profiles.find((p) => p.userId === o.sellerId)?.kitchenName) ||
        (o.restaurantId && rests.find((r) => r.id === o.restaurantId)?.name) ||
        'Kitchen',
    })),
  });
});
