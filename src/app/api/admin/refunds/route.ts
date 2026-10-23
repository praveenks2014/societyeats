import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { kitchenRefundsDue, orders, refunds, sellerProfiles } from '@/lib/db/schema';
import { formatINR } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Platform refunds (Razorpay) and the food refunds kitchens still owe buyers. */
export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const due = await db
    .select({ d: kitchenRefundsDue, kitchenName: sellerProfiles.kitchenName })
    .from(kitchenRefundsDue)
    .innerJoin(sellerProfiles, eq(kitchenRefundsDue.sellerId, sellerProfiles.userId))
    .orderBy(desc(kitchenRefundsDue.id))
    .limit(200);
  const platform = await db.select().from(refunds).orderBy(desc(refunds.id)).limit(200);
  return ok({ kitchenRefundsDue: due.map((r) => ({ ...r.d, kitchenName: r.kitchenName })), platformRefunds: platform });
});

const schema = z.object({ id: z.number().int(), action: z.literal('chase') });

/** Nudge a kitchen about an outstanding food refund. */
export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const db = await getDb();
  const [row] = await db.select().from(kitchenRefundsDue).where(eq(kitchenRefundsDue.id, parsed.data.id));
  if (!row || row.status !== 'due') throw new ApiError(404, 'No outstanding refund with that id');
  await db.update(kitchenRefundsDue).set({ lastChasedAt: new Date() }).where(eq(kitchenRefundsDue.id, row.id));
  await notify(row.sellerId, `Reminder: return ${formatINR(row.amountInPaise)} to the buyer`, `Order #${row.orderId}. Mark it refunded with the UPI reference once done.`, '/seller/refunds-due');
  const [o] = await db.select({ buyerId: orders.buyerId }).from(orders).where(eq(orders.id, row.orderId));
  void o;
  await recordAudit({ actorId: admin.uid, action: 'refund_due.chase', targetType: 'order', targetId: row.orderId });
  return ok({ ok: true });
});
