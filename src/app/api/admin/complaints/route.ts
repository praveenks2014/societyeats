import { desc, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { complaints, orders, sellerProfiles, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ complaint: complaints, order: orders, buyer: users, profile: sellerProfiles })
    .from(complaints)
    .innerJoin(orders, eq(complaints.orderId, orders.id))
    .innerJoin(users, eq(complaints.buyerId, users.id))
    .leftJoin(sellerProfiles, eq(complaints.sellerId, sellerProfiles.userId))
    .orderBy(desc(complaints.createdAt));

  return ok({
    complaints: rows.map((r) => ({
      ...r.complaint,
      buyerName: r.buyer.name,
      buyerPhone: r.buyer.phone,
      kitchenName: r.profile?.kitchenName ?? null,
      orderTotalInPaise: r.order.totalInPaise,
      foodTotalInPaise: r.order.foodTotalInPaise,
      foodPaymentMode: r.order.foodPaymentMode,
      foodPaymentStatus: r.order.foodPaymentStatus,
      // Platform fee still refundable through Razorpay after any earlier refunds.
      feeRefundableInPaise: Math.max(0, r.order.onlineChargeInPaise - r.order.refundInPaise),
    })),
  });
});
