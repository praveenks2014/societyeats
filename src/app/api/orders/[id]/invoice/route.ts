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
import { BRAND } from '@/config/brand';
import { getPlatformSettings } from '@/lib/db/platform';
import { splitGst } from '@/lib/money';

export const dynamic = 'force-dynamic';

/**
 * Per-order invoice. For home-kitchen orders the platform invoices ONLY its
 * own service — the buyer platform fee (+GST on it, and ECO GST on food when
 * that mode is on). The food itself is sold by the kitchen and paid to it
 * directly, so it appears as an information line, not as platform revenue.
 * CGST/SGST assume an intra-state supply — guidance only; verify with a CA.
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

  const settings = await getPlatformSettings();
  const home = order.type === 'home_delivery';
  const feeGst = splitGst(order.platformFeeGstInPaise);
  const ecoGst = splitGst(order.gstInPaise);
  const legal = {
    name: settings.legalEntityName || BRAND.legalEntityName,
    gstin: settings.platformGstin || BRAND.gstin,
    address: settings.registeredAddress || BRAND.registeredAddress,
  };

  return ok({
    model: home ? 'home' : 'mall',
    invoiceNumber: `PP-INV-${String(order.id).padStart(6, '0')}`,
    invoiceDate: payment?.capturedAt ?? order.createdAt,
    isTaxInvoice: home ? order.platformFeeGstInPaise + order.gstInPaise > 0 : false,
    platform: { name: BRAND.appName, legalName: legal.name, gstin: legal.gstin, address: legal.address },
    buyer: {
      name: buyer?.name ?? 'Buyer',
      phone: buyer?.phone ?? '',
      address: order.deliveryAddressJson ? `${order.deliveryAddressJson.flat}, ${order.deliveryAddressJson.addressText}` : null,
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
      foodTotalInPaise: order.foodTotalInPaise,
      foodPaymentMode: order.foodPaymentMode,
      platformFeeBeforeCreditInPaise: order.feeBeforeCreditInPaise,
      platformFeeInPaise: order.platformFeeInPaise,
      feeBps: order.feeBpsSnapshot,
      feeGstInPaise: order.platformFeeGstInPaise,
      feeCgstInPaise: feeGst.cgst,
      feeSgstInPaise: feeGst.sgst,
      feeGstBps: order.feeGstBpsSnapshot,
      ecoGstInPaise: order.gstInPaise,
      ecoCgstInPaise: ecoGst.cgst,
      ecoSgstInPaise: ecoGst.sgst,
      onlineChargeInPaise: order.onlineChargeInPaise,
      referralCreditAppliedInPaise: order.referralCreditAppliedInPaise,
      totalInPaise: order.totalInPaise,
      refundInPaise: order.refundInPaise,
    },
    items: items.map((i) => ({
      title: i.titleSnapshot,
      qty: i.qty,
      unitPriceInPaise: i.unitPriceInPaise,
      amountInPaise: i.qty * i.unitPriceInPaise,
    })),
  });
});
