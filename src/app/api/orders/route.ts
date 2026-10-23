import { desc, eq, inArray } from 'drizzle-orm';
import { api, ApiError, ok, otp4, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { malls, orderEvents, orderItems, orders, restaurantItems, restaurants, sellerProfiles, type DeliveryAddress } from '@/lib/db/schema';
import { pctOf } from '@/lib/money';
import { createHomeOrder } from '@/lib/orders/create';
import { expireUnpaidOrders } from '@/lib/orders/lifecycle';
import { createPaymentForOrder } from '@/lib/payments';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type FulfillmentType = 'self_pickup' | 'seller_delivery' | 'platform_delivery';

type CreateBody = {
  type: 'home_delivery' | 'mall_pickup';
  sellerId?: number;
  restaurantId?: number;
  items: { id: number; qty: number }[];
  address?: DeliveryAddress;
  fulfillmentType?: FulfillmentType;
  /** How the buyer will pay the KITCHEN for the food: UPI right after the fee, or at pickup. */
  foodPaymentMode?: 'upi_now' | 'pay_at_pickup';
  /** Apply available referral credit to the platform fee. */
  useCredit?: boolean;
};

export const POST = api(async (req) => {
  const session = await requireSession();
  // keyed by account, not IP: a whole society can sit behind one shared NAT gateway
  await rateLimit(`orders:create:${session.uid}`, { limit: 20, windowMs: 5 * 60 * 1000 });
  const body = await readJson<CreateBody>(req);
  if (!body.items?.length) throw new ApiError(400, 'Cart is empty');

  if (body.type === 'home_delivery') {
    if (!body.sellerId) throw new ApiError(400, 'Missing seller');
    await expireUnpaidOrders();
    const res = await createHomeOrder({
      buyerId: session.uid,
      buyerApproved: session.approvalStatus === 'approved',
      sellerId: body.sellerId,
      items: body.items,
      fulfillmentType: body.fulfillmentType ?? 'self_pickup',
      foodPaymentMode: body.foodPaymentMode ?? 'pay_at_pickup',
      address: body.address,
      useCredit: body.useCredit,
    });
    return ok({ orderId: res.orderId, totalInPaise: res.quote.grandTotalPaise, onlineChargeInPaise: res.quote.onlineChargePaise, quote: res.quote, payment: res.payment });
  }

  // ---- mall pickup (feature-flagged off for the pilot; legacy full-payment flow) ----
  const db = await getDb();
  const settings = await getPlatformSettings();
  if (!settings.mallModeEnabled) throw new ApiError(503, 'Mall Mode is not available during this pilot');
  if (!body.restaurantId) throw new ApiError(400, 'Missing restaurant');
  const [restaurant] = await db
    .select({ restaurant: restaurants, mall: malls })
    .from(restaurants)
    .innerJoin(malls, eq(restaurants.mallId, malls.id))
    .where(eq(restaurants.id, body.restaurantId));
  if (!restaurant) throw new ApiError(404, 'Restaurant not found');

  const rows = await db.select().from(restaurantItems).where(inArray(restaurantItems.id, body.items.map((i) => i.id)));
  let subtotal = 0;
  const itemRows: (typeof orderItems.$inferInsert)[] = [];
  for (const item of body.items) {
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 50) throw new ApiError(400, 'Invalid item quantity');
    const ri = rows.find((r) => r.id === item.id);
    if (!ri || !ri.isActive || ri.restaurantId !== body.restaurantId) throw new ApiError(400, 'An item in your cart is no longer available');
    if (ri.stockQty < item.qty) throw new ApiError(400, `Only ${ri.stockQty} of "${ri.title}" left`);
    subtotal += item.qty * ri.priceInPaise;
    itemRows.push({ orderId: 0, restaurantItemId: ri.id, titleSnapshot: ri.title, qty: item.qty, unitPriceInPaise: ri.priceInPaise });
  }
  const commission = pctOf(subtotal, settings.commissionMallPct);
  const total = subtotal + settings.platformFeePaise;
  const [order] = await db
    .insert(orders)
    .values({
      buyerId: session.uid,
      type: 'mall_pickup',
      restaurantId: body.restaurantId,
      status: 'placed',
      subtotalInPaise: subtotal,
      deliveryFeeInPaise: 0,
      foodTotalInPaise: subtotal,
      platformFeeInPaise: settings.platformFeePaise,
      commissionInPaise: commission,
      onlineChargeInPaise: total,
      totalInPaise: total,
      otpCode: otp4(),
    })
    .returning();
  await db.insert(orderItems).values(itemRows.map((r) => ({ ...r, orderId: order.id })));
  await db.insert(orderEvents).values({ orderId: order.id, status: 'placed', note: 'Order placed' });
  const payment = await createPaymentForOrder(order.id, total);
  return ok({ orderId: order.id, totalInPaise: total, payment });
});

export const GET = api(async () => {
  const session = await requireSession();
  await expireUnpaidOrders();
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
