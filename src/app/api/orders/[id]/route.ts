import { asc, desc, eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { fssaiApplications, malls, orderEvents, orderItems, orders, payments, restaurants, reviews, sellerProfiles, users } from '@/lib/db/schema';
import { fssaiTierInfo } from '@/lib/fssai/tier';
import { buyerHandle } from '@/lib/handles';
import { applyOrderTimers } from '@/lib/orders/lifecycle';
import { QR_REVEAL_STATES, STATUS_LABEL, ADDRESS_VISIBLE_STATES, type OrderStatus } from '@/lib/orders/state';
import { allowedActions, redactOrder, viewerActor } from '@/lib/orders/view';
import { buildUpiUri, upiQrSvg } from '@/lib/upi';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  if (!Number.isInteger(orderId)) throw new ApiError(404, 'Order not found');
  await applyOrderTimers(orderId); // lazy timers: expiry, auto-cancel, auto-complete
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');

  // authorization: buyer, the seller, the restaurant manager, or admin
  const viewer = { uid: session.uid, role: session.role };
  let allowed = viewerActor(order, viewer) !== null;
  let restaurant = null;
  let mall = null;
  if (order.restaurantId) {
    const [row] = await db
      .select({ restaurant: restaurants, mall: malls })
      .from(restaurants)
      .innerJoin(malls, eq(restaurants.mallId, malls.id))
      .where(eq(restaurants.id, order.restaurantId));
    restaurant = row?.restaurant ?? null;
    mall = row?.mall ?? null;
    if (restaurant?.managerUserId === session.uid) allowed = true;
  }
  if (!allowed) throw new ApiError(403, 'Not your order');

  const settings = await getPlatformSettings();
  const now = new Date();
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).orderBy(asc(orderEvents.createdAt));
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
  const [review] = await db.select().from(reviews).where(eq(reviews.orderId, orderId));

  let profileRow: typeof sellerProfiles.$inferSelect | null = null;
  if (order.sellerId) {
    const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, order.sellerId));
    profileRow = p ?? null;
  }
  const actor = viewerActor(order, viewer);
  const isAdmin = actor === 'admin';
  const isBuyerViewer = actor === 'buyer';

  // The kitchen's pickup point (tower + instructions) is revealed to the buyer only after the kitchen accepts.
  let pickup: { tower: string | null; instructions: string | null } | null = null;
  if (profileRow && (isBuyerViewer || isAdmin) && (ADDRESS_VISIBLE_STATES.includes(order.status as OrderStatus) || isAdmin)) {
    pickup = { tower: profileRow.tower, instructions: profileRow.pickupInstructions };
  }

  // The kitchen's UPI ID, its bank-registered name and the QR are revealed ONLY once the order is at the door (or later),
  // and only to the buyer (and admin). Before that, no byte of it leaves the server.
  let upi: { vpa: string; registeredName: string; payeeName: string; uri: string; qrSvg: string; amountInPaise: number } | null = null;
  if (order.type === 'home_delivery' && (isBuyerViewer || isAdmin) && QR_REVEAL_STATES.includes(order.status as OrderStatus) && order.sellerVpaSnapshot) {
    const payee = order.sellerRegisteredNameSnapshot || profileRow?.kitchenName || 'Kitchen';
    const uri = buildUpiUri({ vpa: order.sellerVpaSnapshot, payeeName: payee, amountInPaise: order.foodTotalInPaise, orderId });
    upi = { vpa: order.sellerVpaSnapshot, registeredName: order.sellerRegisteredNameSnapshot ?? payee, payeeName: payee, uri, qrSvg: await upiQrSvg(uri), amountInPaise: order.foodTotalInPaise };
  }

  // FSSAI line shown on the order and the receipt.
  let fssai: { tier: string; number: string | null } | null = null;
  if (profileRow) {
    const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, profileRow.userId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
    const info = fssaiTierInfo(profileRow, app ?? null, { deemedDays: settings.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: settings.provisionalMaxDays, now });
    fssai = { tier: info.tier, number: profileRow.fssaiStatus === 'verified' ? profileRow.fssaiNumber : null };
  }

  const [buyer] = isAdmin ? await db.select().from(users).where(eq(users.id, order.buyerId)) : [];
  const safe = redactOrder(order, viewer, now);
  // Mall orders keep their pickup OTP for the buyer.
  const showOtp = order.type === 'mall_pickup' && (isBuyerViewer || isAdmin) && ['ready'].includes(order.status);

  return ok({
    order: { ...safe, otpCode: showOtp ? order.otpCode : null },
    statusLabel: STATUS_LABEL[order.status as OrderStatus] ?? order.status,
    items,
    events,
    payment: payment ? { status: payment.status, amountInPaise: payment.amountInPaise, refundedInPaise: payment.refundedInPaise, kind: payment.kind } : null,
    review: review ?? null,
    vendor: restaurant
      ? { kind: 'restaurant', name: restaurant.name, counterNumber: restaurant.counterNumber, mallName: mall?.name }
      : { kind: 'seller', name: profileRow?.kitchenName ?? null, acceptsCash: !!profileRow?.acceptsCash },
    // Handles only — no names or phone numbers between buyer and kitchen.
    buyer: { handle: buyerHandle(orderId, order.buyerId), ...(isAdmin ? { name: buyer?.name, phone: buyer?.phone } : {}) },
    pickup,
    upi,
    fssai,
    foodPayment: { mode: order.foodPaymentMode ?? null, status: order.foodPaymentStatus ?? null, utr: order.foodPaymentUtr ?? null, method: order.foodPaymentMethod ?? null },
    actions: allowedActions(order, viewer, { atDoorWaitMinutes: settings.atDoorWaitMinutes }, now),
    timers: {
      acceptBy: order.status === 'booked' ? order.acceptBy : null,
      noShowAfter: order.status === 'at_door' && order.atDoorAt ? new Date(order.atDoorAt.getTime() + settings.atDoorWaitMinutes * 60_000) : null,
      confirmBy: order.status === 'payment_claimed' && order.foodPaymentClaimedAt ? new Date(order.foodPaymentClaimedAt.getTime() + settings.sellerConfirmPaymentHours * 3_600_000) : null,
    },
    viewerRole: session.role,
    viewerIsBuyer: isBuyerViewer,
    viewerIsKitchen: actor === 'seller',
  });
});
