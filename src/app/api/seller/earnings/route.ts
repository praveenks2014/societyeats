import { desc, eq, inArray } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orderItems, orders } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.sellerId, session.uid))
    .orderBy(desc(orders.createdAt));

  const completed = rows.filter((o) => o.status === 'delivered');
  const gross = completed.reduce((s, o) => s + o.subtotalInPaise, 0);
  const commission = completed.reduce((s, o) => s + o.commissionInPaise, 0);
  const deliveryCollected = completed.reduce((s, o) => s + o.deliveryFeeInPaise, 0);

  const ids = completed.slice(0, 30).map((o) => o.id);
  const items = ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];

  return ok({
    totals: {
      grossPaise: gross,
      commissionPaise: commission,
      deliveryCollectedPaise: deliveryCollected,
      netPayablePaise: gross - commission,
      orderCount: completed.length,
    },
    ledger: completed.slice(0, 30).map((o) => ({
      id: o.id,
      createdAt: o.createdAt,
      subtotalInPaise: o.subtotalInPaise,
      commissionInPaise: o.commissionInPaise,
      netPaise: o.subtotalInPaise - o.commissionInPaise,
      items: items.filter((i) => i.orderId === o.id).map((i) => `${i.titleSnapshot} ×${i.qty}`),
    })),
  });
});
