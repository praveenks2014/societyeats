import { and, eq, inArray } from 'drizzle-orm';
import { ApiError, otp4 } from '@/lib/api';
import { assertBuyerCanOrder } from '@/lib/access';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { listings, orderEvents, orderItems, orders, referralCredits, sellerProfiles, societies, userBlocks, users, type DeliveryAddress } from '@/lib/db/schema';
import { effectiveCaps, checkCaps, fssaiTierInfo } from '@/lib/fssai/tier';
import { haversineKm, type GeoPoint } from '@/lib/geo';
import { kitchenGate } from '@/lib/kitchen/gate';
import { assertLiveModeReady } from '@/lib/live-guard';
import { feeConfigFromSettings, quoteOrder, type OrderQuote } from '@/lib/money';
import { createOrderPayment, markOrderPaid, type CheckoutPayload } from '@/lib/payments';
import { reserveCredit } from '@/lib/referrals';
import { currentSlot, isSlotSoldOut } from '@/lib/slots';
import { fssaiApplications } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { sellerCapUsage, sellerFySalesPaise } from './caps';
import { reserveStock } from './stock';

export type HomeOrderInput = {
  buyerId: number;
  sellerId: number;
  items: { id: number; qty: number }[];
  fulfillmentType: 'self_pickup' | 'seller_delivery' | 'platform_delivery';
  address?: DeliveryAddress;
  useCredit?: boolean;
  /** Pre-order for a later slot (IST). Needs the preOrdersEnabled flag. */
  scheduledFor?: Date | null;
  buyerNote?: string;
};

/**
 * Creates a home-kitchen order. The buyer's booking payment is the platform fee (+GST) ONLY; the food
 * (shown upfront on every screen) is paid to the kitchen at the door after it arrives:
 *   Food — NOT collected by the platform
 *   Platform fee (+GST, +food GST in registered_eco_9_5 mode) — collected via Razorpay now
 * Stock, referral credit and the kitchen's provisional-sales caps are enforced in the same transaction
 * as the order insert, under a row lock on the kitchen, so two simultaneous bookings can never both
 * take the last slot.
 */
export async function createHomeOrder(input: HomeOrderInput): Promise<{ orderId: number; quote: OrderQuote; payment: CheckoutPayload }> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  await assertBuyerCanOrder(input.buyerId);
  if (!input.items.length) throw new ApiError(400, 'Cart is empty');
  if (input.fulfillmentType === 'platform_delivery') {
    // A courier cannot run the pay-at-the-door QR flow, and a delivery fee would be platform-collected money.
    throw new ApiError(400, 'Third-party delivery is not available in this version');
  }
  if (input.scheduledFor && !settings.preOrdersEnabled) throw new ApiError(400, 'Pre-orders are not enabled');
  await assertLiveModeReady(settings);

  // A kitchen that blocked this buyer in chat can refuse new orders from them.
  const [blockedByKitchen] = await db.select({ id: userBlocks.id }).from(userBlocks).where(and(eq(userBlocks.blockerId, input.sellerId), eq(userBlocks.blockedId, input.buyerId)));
  if (blockedByKitchen) throw new ApiError(403, 'This kitchen is not taking orders from you');
  const gate = await kitchenGate(input.sellerId);
  const profile = gate.profile;
  if (!profile || !gate.ok) throw new ApiError(400, 'This kitchen is not accepting orders right now');
  if (!profile.upiVerifiedVpa || !profile.upiVerifiedName) throw new ApiError(400, 'This kitchen is not accepting orders right now');
  if (input.fulfillmentType === 'self_pickup' && !profile.offersSelfPickup) throw new ApiError(400, 'This kitchen does not offer self-pickup');
  if (input.fulfillmentType === 'seller_delivery' && !profile.offersSellerDelivery) throw new ApiError(400, 'This kitchen does not offer its own delivery');

  let addr: DeliveryAddress | null = null;
  if (input.fulfillmentType === 'seller_delivery') {
    if (!input.address) throw new ApiError(400, 'Missing delivery address');
    addr = input.address;
    if (typeof addr.lat !== 'number' || typeof addr.lng !== 'number' || !addr.flat?.trim()) throw new ApiError(400, 'Delivery address is incomplete');
    const [seller] = await db.select().from(users).where(eq(users.id, input.sellerId));
    let point: GeoPoint | null = seller?.lat != null && seller?.lng != null ? { lat: seller.lat, lng: seller.lng } : null;
    if (!point && seller?.societyId) {
      const [soc] = await db.select().from(societies).where(eq(societies.id, seller.societyId));
      if (soc) point = { lat: soc.lat, lng: soc.lng };
    }
    if (!point) throw new ApiError(400, 'Kitchen location unavailable');
    const distance = haversineKm({ lat: addr.lat, lng: addr.lng }, point);
    if (distance > settings.radiusKm) throw new ApiError(400, `This kitchen is ${distance.toFixed(1)} km away — outside the ${settings.radiusKm} km radius`);
    if (distance > profile.sellerDeliveryRadiusKm) throw new ApiError(400, `This kitchen only delivers within ${profile.sellerDeliveryRadiusKm} km — you're ${distance.toFixed(1)} km away. Try self-pickup instead.`);
  }

  // ---- items (quantities validated as positive integers) ----
  for (const i of input.items) {
    if (!Number.isInteger(i.id) || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 50) throw new ApiError(400, 'Invalid item quantity');
  }
  const merged = new Map<number, number>();
  for (const i of input.items) merged.set(i.id, (merged.get(i.id) ?? 0) + i.qty);
  const rows = await db.select().from(listings).where(inArray(listings.id, [...merged.keys()]));
  let subtotal = 0;
  const lines: { listingId: number; qty: number; title: string; unit: number }[] = [];
  for (const [id, qty] of merged) {
    const l = rows.find((r) => r.id === id);
    if (!l || !l.isActive || l.sellerId !== input.sellerId || l.moderationStatus !== 'approved') throw new ApiError(400, 'An item in your cart is no longer available');
    if (l.availableQty < qty) throw new ApiError(409, `Only ${l.availableQty} of "${l.title}" left`);
    subtotal += qty * l.priceInPaise;
    lines.push({ listingId: l.id, qty, title: l.title, unit: l.priceInPaise });
  }
  if (profile.minOrderPaise > 0 && subtotal < profile.minOrderPaise) throw new ApiError(400, `This kitchen's minimum order is ₹${(profile.minOrderPaise / 100).toFixed(0)}`);

  const slot = currentSlot();
  const cartSlots = rows.flatMap((l) => l.slotsJson?.slots ?? []);
  if (!input.scheduledFor && slot && (cartSlots.length === 0 || cartSlots.includes(slot))) {
    if (await isSlotSoldOut(input.sellerId, profile.maxOrdersPerSlot, cartSlots)) {
      throw new ApiError(400, 'This kitchen is sold out for the current meal slot — try again next slot');
    }
  }

  const deliveryFee = input.fulfillmentType === 'seller_delivery' && settings.sellerDeliveryFeeEnabled ? profile.sellerDeliveryFeeInPaise : 0;
  const cfg = feeConfigFromSettings(settings);
  const now = new Date();
  const [application] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, input.sellerId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const tierInfo = fssaiTierInfo(profile, application ?? null, { deemedDays: settings.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: settings.provisionalMaxDays, now });

  const created = await db.transaction(async (tx) => {
    // Row lock on the kitchen: bookings for the same kitchen are serialised, so cap checks cannot race.
    await tx.select({ id: sellerProfiles.userId }).from(sellerProfiles).where(eq(sellerProfiles.userId, input.sellerId)).for('update');

    const usage = await sellerCapUsage(tx, input.sellerId, now);
    if (usage.ordersToday + 1 > profile.maxOrdersPerDay) throw new ApiError(409, 'Fully booked today');
    const foodForCaps = subtotal + deliveryFee;
    if (tierInfo.tier === 'provisional') {
      const caps = effectiveCaps(settings, profile.capOverrideJson, now);
      const check = checkCaps(caps, usage, foodForCaps);
      if (!check.ok) throw new ApiError(409, check.message);
    }
    // Sec 393 (ex-194-O) tracking: new orders pause at the statutory gross-sales threshold until an admin decides.
    if (settings.tdsPausePaise > 0 && (await sellerFySalesPaise(tx, input.sellerId, now)) >= settings.tdsPausePaise) {
      throw new ApiError(409, 'This kitchen is not taking new orders right now');
    }

    let available = 0;
    if (input.useCredit) {
      const credits = await tx.select({ a: referralCredits.amountInPaise }).from(referralCredits).where(and(eq(referralCredits.buyerId, input.buyerId), eq(referralCredits.status, 'available')));
      available = credits.reduce((s, c) => s + c.a, 0);
    }
    const quote = quoteOrder({ foodSubtotalPaise: subtotal, sellerDeliveryFeePaise: deliveryFee, availableCreditPaise: available }, cfg);

    const [order] = await tx
      .insert(orders)
      .values({
        buyerId: input.buyerId,
        type: 'home_delivery',
        sellerId: input.sellerId,
        status: 'fee_pending',
        fulfillmentType: input.fulfillmentType,
        subtotalInPaise: quote.foodSubtotalPaise,
        deliveryFeeInPaise: quote.sellerDeliveryFeePaise,
        foodTotalInPaise: quote.foodTotalPaise,
        platformFeeInPaise: quote.platformFeePaise,
        platformFeeGstInPaise: quote.feeGstPaise,
        feeBeforeCreditInPaise: quote.feeBeforeCreditPaise,
        gstInPaise: quote.ecoGstPaise,
        commissionInPaise: 0,
        referralCreditAppliedInPaise: quote.creditAppliedPaise,
        onlineChargeInPaise: quote.onlineChargePaise,
        totalInPaise: quote.grandTotalPaise,
        feeBpsSnapshot: quote.snapshot.feeBps,
        feeMinSnapshot: quote.snapshot.feeMinPaise,
        feeMaxSnapshot: quote.snapshot.feeMaxPaise,
        feeGstBpsSnapshot: quote.snapshot.feeGstBps,
        ecoModeSnapshot: quote.snapshot.ecoMode,
        ecoBpsSnapshot: quote.snapshot.ecoBps,
        gstModeSnapshot: settings.gstMode,
        foodPaymentMode: 'pay_at_door',
        foodPaymentStatus: 'pending',
        sellerVpaSnapshot: profile.upiVerifiedVpa,
        sellerRegisteredNameSnapshot: profile.upiVerifiedName,
        deliveryAddressJson: addr,
        otpCode: otp4(),
        scheduledFor: input.scheduledFor ?? null,
        buyerNote: input.buyerNote?.slice(0, 300) ?? null,
        expiresAt: new Date(now.getTime() + settings.unpaidOrderExpiryMinutes * 60_000),
        stockReserved: true,
      })
      .returning();

    await reserveStock(tx, lines);
    if (quote.creditAppliedPaise > 0) {
      const got = await reserveCredit(tx, input.buyerId, order.id, quote.creditAppliedPaise);
      if (got !== quote.creditAppliedPaise) throw new ApiError(409, 'Your referral credit changed — please try again');
    }
    await tx.insert(orderItems).values(lines.map((l) => ({ orderId: order.id, listingId: l.listingId, titleSnapshot: l.title, qty: l.qty, unitPriceInPaise: l.unit })));
    await tx.insert(orderEvents).values({ orderId: order.id, status: 'fee_pending', note: 'Order created — waiting for the platform fee' });
    return { order, quote };
  });

  const { order, quote } = created;
  if (quote.onlineChargePaise === 0) {
    // Nothing for Razorpay to collect (0% fee, or fully covered by credit).
    await markOrderPaid(order.id, { method: 'none' });
    return { orderId: order.id, quote, payment: { mode: 'none', orderId: order.id, amountInPaise: 0 } };
  }
  const payment = await createOrderPayment(order.id, quote.onlineChargePaise, 'order_fee');
  return { orderId: order.id, quote, payment };
}
