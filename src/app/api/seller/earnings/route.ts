import { desc, eq, inArray, sql, and } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { kitchenRefundsDue, orderItems, orders } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * A kitchen's own sales record. The food money is paid to the kitchen
 * directly by buyers (UPI / at pickup) — PadosiPlate never holds or pays it
 * out — so this page is a ledger for the kitchen's books, not a payout.
 */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const completed = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sellerId, session.uid), inArray(orders.status, ['delivered', 'picked_up'])))
    .orderBy(desc(orders.completedAt));

  const foodTotal = completed.reduce((s, o) => s + o.foodTotalInPaise, 0);
  const upi = completed.filter((o) => o.foodPaymentMode === 'upi_now').reduce((s, o) => s + o.foodTotalInPaise, 0);
  const [due] = await db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${kitchenRefundsDue.amountInPaise}), 0)` })
    .from(kitchenRefundsDue)
    .where(and(eq(kitchenRefundsDue.sellerId, session.uid), eq(kitchenRefundsDue.status, 'due')));

  const ids = completed.slice(0, 30).map((o) => o.id);
  const items = ids.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [];
  return ok({
    totals: {
      foodReceivedPaise: foodTotal,
      viaUpiPaise: upi,
      atHandoverPaise: foodTotal - upi,
      orderCount: completed.length,
      refundsDueCount: Number(due?.n ?? 0),
      refundsDuePaise: Number(due?.total ?? 0),
    },
    ledger: completed.slice(0, 30).map((o) => ({
      id: o.id,
      completedAt: o.completedAt,
      foodTotalInPaise: o.foodTotalInPaise,
      mode: o.foodPaymentMode,
      items: items.filter((i) => i.orderId === o.id).map((i) => `${i.titleSnapshot} ×${i.qty}`),
    })),
  });
});
