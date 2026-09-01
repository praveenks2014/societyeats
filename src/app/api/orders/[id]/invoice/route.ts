import { eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  malls,
  orderItems,
  orders,
  payments,
  restaurants,
  sellerProfiles,
  users,
} from '@/lib/db/schema';
import { BRAND } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * Per-order tax invoice — GharSe issues it, not the cook: the platform is the
 * deemed supplier under Sec 9(5) CGST for home-food orders (DECISIONS.md
 * #58+). CGST/SGST assume an intra-state supply (the pilot is one Hyderabad
 * society) — guidance only, not a legal determination; verify with a CA
 * before relying on this for filing.
 */
export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');

  // same authorization as GET /api/orders/[id]: buyer, seller, restaurant manager, or admin
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

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
  const [buyer] = await db.select().from(users).where(eq(users.id, order.buyerId));

  let kitchenName: string | null = null;
  let fssaiNumber: string | null = null;
  if (order.sellerId) {
    const [p] = await db
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, order.sellerId));
    kitchenName = p?.kitchenName ?? null;
    fssaiNumber = p?.fssaiNumber ?? null;
  }

  const cgstInPaise = Math.round(order.gstInPaise / 2);
  const sgstInPaise = order.gstInPaise - cgstInPaise;

  return ok({
    invoiceNumber: `GHS-INV-${String(order.id).padStart(6, '0')}`,
    invoiceDate: payment?.capturedAt ?? order.createdAt,
    isTaxInvoice: order.gstInPaise > 0,
    platform: { name: BRAND.name, gstin: BRAND.gstin, address: BRAND.registeredAddress },
    buyer: {
      name: buyer?.name ?? 'Buyer',
      phone: buyer?.phone ?? '',
      address: order.deliveryAddressJson
        ? `${order.deliveryAddressJson.flat}, ${order.deliveryAddressJson.addressText}`
        : null,
    },
    fulfilledBy: restaurant
      ? { label: restaurant.name, sub: mall?.name, fssaiNumber: restaurant.fssaiNumber }
      : { label: kitchenName ?? 'Kitchen', sub: null, fssaiNumber },
    order: {
      id: order.id,
      type: order.type,
      fulfillmentType: order.fulfillmentType,
      createdAt: order.createdAt,
      subtotalInPaise: order.subtotalInPaise,
      deliveryFeeInPaise: order.deliveryFeeInPaise,
      platformFeeInPaise: order.platformFeeInPaise,
      gstInPaise: order.gstInPaise,
      cgstInPaise,
      sgstInPaise,
      referralCreditAppliedInPaise: order.referralCreditAppliedInPaise,
      totalInPaise: order.totalInPaise,
    },
    items: items.map((i) => ({
      title: i.titleSnapshot,
      qty: i.qty,
      unitPriceInPaise: i.unitPriceInPaise,
      amountInPaise: i.qty * i.unitPriceInPaise,
    })),
  });
});
