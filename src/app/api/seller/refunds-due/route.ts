import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { kitchenRefundsDue, orders } from '@/lib/db/schema';
import { formatINR } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Food refunds this kitchen owes buyers (the platform never held the food money). */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db.select().from(kitchenRefundsDue).where(eq(kitchenRefundsDue.sellerId, session.uid)).orderBy(desc(kitchenRefundsDue.id));
  return ok({ items: rows });
});

const schema = z.object({ id: z.number().int(), utr: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/, 'Enter the UPI reference (6–30 letters/digits)') });

/** Kitchen marks a refund as returned to the buyer, with the UPI reference. */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const db = await getDb();
  const [row] = await db
    .update(kitchenRefundsDue)
    .set({ status: 'refunded', refundUtr: parsed.data.utr, refundedAt: new Date() })
    .where(and(eq(kitchenRefundsDue.id, parsed.data.id), eq(kitchenRefundsDue.sellerId, session.uid), eq(kitchenRefundsDue.status, 'due')))
    .returning();
  if (!row) throw new ApiError(404, 'No outstanding refund with that id');
  const [o] = await db.select({ buyerId: orders.buyerId }).from(orders).where(eq(orders.id, row.orderId));
  if (o) await notify(o.buyerId, `Kitchen returned ${formatINR(row.amountInPaise)} for order #${row.orderId}`, `UPI reference ${parsed.data.utr}. Tell us if it hasn't arrived.`, `/orders/${row.orderId}`);
  return ok({ ok: true });
});
