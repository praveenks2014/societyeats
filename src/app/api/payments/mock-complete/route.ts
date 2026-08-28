import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { isMockMode } from '@/lib/config';
import { markOrderPaid, markPaymentFailed } from '@/lib/payments';

export const dynamic = 'force-dynamic';

/** MOCK_MODE only: the styled fake checkout sheet posts its outcome here. */
export const POST = api(async (req) => {
  if (!isMockMode()) throw new ApiError(403, 'Mock payments are disabled in live mode');
  const session = await requireSession();
  const { orderId, outcome } = await readJson<{ orderId: number; outcome: 'success' | 'failure' }>(req);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.buyerId !== session.uid) throw new ApiError(404, 'Order not found');

  if (outcome === 'success') {
    // simulate gateway latency
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
    await markOrderPaid(orderId, { method: 'upi (test)' });
    return ok({ ok: true, status: 'paid' });
  }
  await markPaymentFailed(orderId);
  return ok({ ok: true, status: 'failed' });
});
