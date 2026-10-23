import { and, eq, inArray } from 'drizzle-orm';
import { ApiError, otp4 } from '@/lib/api';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { listings, orderEvents, orderItems, orders, referralCredits, societies, users, type DeliveryAddress } from '@/lib/db/schema';
import { haversineKm, type GeoPoint } from '@/lib/geo';
import { kitchenGate } from '@/lib/kitchen/gate';
import { feeConfigFromSettings, quoteOrder, type OrderQuote } from '@/lib/money';
import { createOrderPayment, markOrderPaid, type CheckoutPayload } from '@/lib/payments';
import { reserveCredit } from '@/lib/referrals';
import { currentSlot, isSlotSoldOut } from '@/lib/slots';
import { reserveStock } from './stock';

export type HomeOrderInput = {
  buyerId: number;
  buyerApproved: boolean;
  sellerId: number;
  items: { id: number; qty: number }[];
  fulfillmentType: 'self_pickup' | 'seller_delivery' | 'platform_delivery';
  foodPaymentMode: 'upi_now' | 'pay_at_pickup';
  address?: DeliveryAddress;
  useCredit?: boolean;
};

/**
 * Creates a home-kitchen order. The buyer's bill is two parts:
 *   Food (paid directly to the kitchen) — NOT collected by the platform
 *   Platform fee (+GST) — collected via Razorpay
 * Stock and referral credit are reserved in the same transaction as the order.
 */
export async function createHomeOrder(input: HomeOrderInput): Promise<{ orderId: number; quote: OrderQuote; payment: CheckoutPayload }> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  if (!input.buyerApproved) throw new ApiError(403, 'Your account is waiting for approval from your society admin');
  if (!input.items.length) throw new ApiError(400, 'Cart is empty');
  if (!['upi_now', 'pay_at_pickup'].includes(input.foodPaymentMode)) throw new ApiError(400, 'Choose how you will pay the kitchen');
  if (input.fulfillmentType === 'platform_delivery') {
    // A third-party delivery fee would be money the platform collects and passes on —
    // out of scope while the platform holds no payment-aggregator licence.
    throw new ApiError(400, 'Delivery-partner pickup is not available in this version');
  }

  // Live orders need the platform's own FSSAI e-commerce registration.
  if (!isMockMode() && !settings.platformFssaiCentralLicenseNo) {
    throw new ApiError(503, 'Live orders are paused — the platform FSSAI registration has not been entered yet. Contact support.');
  }

  const gate = await kitchenGate(input.sellerId);
  const profile = gate.profile;
  if (!profile || !gate.ok) throw new ApiError(400, 'This kitchen is not accepting orders right now');
  if (input.foodPaymentMode === 'upi_now' && !profile.acceptsUpiNow) throw new ApiError(400, 'This kitchen does not take UPI payments up front — choose pay at pickup');
  if (input.foodPaymentMode === 'pay_at_pickup' && !profile.acceptsPayAtPickup) throw new ApiError(400, 'This kitchen only takes payment by UPI up front');
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

  const slot = currentSlot();
  const cartSlots = rows.flatMap((l) => l.slotsJson?.slots ?? []);
  if (slot && (cartSlots.length === 0 || cartSlots.includes(slot))) {
    if (await isSlotSoldOut(input.sellerId, profile.maxOrdersPerSlot, cartSlots)) {
      throw new ApiError(400, 'This kitchen is sold out for the current meal slot — try again next slot');
    }
  }

  const deliveryFee = input.fulfillmentType === 'seller_delivery' ? profile.sellerDeliveryFeeInPaise : 0;
  const cfg = feeConfigFromSettings(settings);
  const now = new Date();

  const created = await db.transaction(async (tx) => {
    // Available referral credit, read inside the transaction.
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
        status: 'placed',
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
        foodPaymentMode: input.foodPaymentMode,
        foodPaymentStatus: 'pending',
        deliveryAddressJson: addr,
        otpCode: otp4(),
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
    await tx.insert(orderEvents).values({ orderId: order.id, status: 'placed', note: 'Order placed — waiting for the platform fee' });
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
