import { asc, eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  deliveries,
  malls,
  orderEvents,
  orderItems,
  orders,
  payments,
  restaurants,
  reviews,
  sellerProfiles,
  users,
} from '@/lib/db/schema';
import { syncDeliveryTracking } from '@/lib/delivery/orchestrator';
import { buyerHandle } from '@/lib/handles';
import { expireUnpaidOrders } from '@/lib/orders/lifecycle';
import { buildUpiUri, upiQrSvg } from '@/lib/upi';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  await expireUnpaidOrders(new Date(), orderId); // lazy expiry check on read
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');

  // authorization: buyer, the seller, the restaurant manager, or admin
  let allowed = order.buyerId === session.uid || session.role === 'admin';
  if (!allowed && order.sellerId === session.uid) allowed = true;
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

  // lazily sync courier tracking — only meaningful for platform-delivery
  // orders, the only fulfillment type that ever gets a `deliveries` row
  let tracking = null;
  if (
    order.fulfillmentType === 'platform_delivery' &&
    ['ready', 'out_for_delivery'].includes(order.status)
  ) {
    tracking = await syncDeliveryTracking(orderId);
  }

  const [freshOrder] = await db.select().from(orders).where(eq(orders.id, orderId));
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const events = await db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.createdAt));
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.orderId, orderId));
  const [review] = await db.select().from(reviews).where(eq(reviews.orderId, orderId));

  let kitchenName: string | null = null;
  let profileRow: typeof sellerProfiles.$inferSelect | null = null;
  if (order.sellerId) {
    const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, order.sellerId));
    profileRow = p ?? null;
    kitchenName = p?.kitchenName ?? null;
  }
  const isAdmin = session.role === 'admin';
  const isBuyerViewer = order.buyerId === session.uid;
  const [buyer] = isAdmin ? await db.select().from(users).where(eq(users.id, order.buyerId)) : [];

  // Society + tower are revealed to the counterparty only after the kitchen accepts.
  const accepted = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up'].includes(freshOrder?.status ?? '');
  let pickup: { tower: string | null; instructions: string | null } | null = null;
  if (profileRow && (accepted || isAdmin) && (isBuyerViewer || isAdmin)) {
    pickup = { tower: profileRow.tower, instructions: profileRow.pickupInstructions };
  }

  // UPI details are shown to the buyer ONLY inside their own order (and to admin).
  let upi: { vpa: string; payeeName: string; uri: string; qrSvg: string; amountInPaise: number } | null = null;
  if (
    profileRow?.upiVpa &&
    freshOrder?.foodPaymentMode === 'upi_now' &&
    (isBuyerViewer || isAdmin) &&
    ['fee_paid', 'awaiting_kitchen_payment_confirmation', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(freshOrder.status)
  ) {
    const uri = buildUpiUri({ vpa: profileRow.upiVpa, payeeName: profileRow.upiName || profileRow.kitchenName, amountInPaise: freshOrder.foodTotalInPaise, orderId });
    upi = { vpa: profileRow.upiVpa, payeeName: profileRow.upiName || profileRow.kitchenName, uri, qrSvg: await upiQrSvg(uri), amountInPaise: freshOrder.foodTotalInPaise };
  }

  // the buyer sees the OTP only when it's time to use it
  const showOtp =
    (order.buyerId === session.uid &&
      ['out_for_delivery', 'ready'].includes(freshOrder?.status ?? '')) ||
    session.role === 'admin';

  return ok({
    order: { ...freshOrder, otpCode: showOtp ? freshOrder?.otpCode : null },
    items,
    events,
    payment: payment ?? null,
    delivery: delivery ?? null,
    tracking,
    review: review ?? null,
    vendor: restaurant
      ? { kind: 'restaurant', name: restaurant.name, counterNumber: restaurant.counterNumber, mallName: mall?.name }
      : { kind: 'seller', name: kitchenName },
    // Handles only — no names or phone numbers between buyer and kitchen.
    buyer: { handle: buyerHandle(orderId, order.buyerId), ...(isAdmin ? { name: buyer?.name, phone: buyer?.phone } : {}) },
    pickup,
    upi,
    foodPayment: { mode: freshOrder?.foodPaymentMode ?? null, status: freshOrder?.foodPaymentStatus ?? null, utr: freshOrder?.foodPaymentUtr ?? null },
    viewerRole: session.role,
    viewerIsBuyer: order.buyerId === session.uid,
  });
});
