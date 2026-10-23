import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { kitchenSubscriptions, orders } from '@/lib/db/schema';
import { markOrderPaid, markPaymentFailed } from '@/lib/payments';
import { markSubscriptionPaid } from '@/lib/subscriptions/service';

export const dynamic = 'force-dynamic';

/** MOCK_MODE only: the styled fake checkout sheet posts its outcome here (orders or subscriptions). */
export const POST = api(async (req) => {
  if (!isMockMode()) throw new ApiError(403, 'Mock payments are disabled in live mode');
  const session = await requireSession();
  const { orderId, subscriptionId, outcome } = await readJson<{ orderId?: number; subscriptionId?: number; outcome: 'success' | 'failure' }>(req);
  const db = await getDb();

  if (subscriptionId) {
    const [sub] = await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.id, subscriptionId));
    if (!sub || sub.sellerId !== session.uid) throw new ApiError(404, 'Subscription not found');
    if (outcome !== 'success') return ok({ ok: true, status: 'failed' });
    await new Promise((r) => setTimeout(r, process.env.NODE_ENV === 'test' ? 0 : 300));
    const r = await markSubscriptionPaid(subscriptionId);
    return ok({ ok: true, status: 'active', won: r.won });
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, Number(orderId)));
  if (!order || order.buyerId !== session.uid) throw new ApiError(404, 'Order not found');
  if (outcome === 'success') {
    await new Promise((r) => setTimeout(r, process.env.NODE_ENV === 'test' ? 0 : 300 + Math.random() * 400));
    const r = await markOrderPaid(Number(orderId), { method: 'upi (test)' });
    return ok({ ok: true, status: r.status ?? 'paid', won: r.won });
  }
  await markPaymentFailed(Number(orderId));
  return ok({ ok: true, status: 'failed' });
});
