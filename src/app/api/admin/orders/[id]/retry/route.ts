import { eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { retryDispatch } from '@/lib/delivery/orchestrator';

export const dynamic = 'force-dynamic';

/** Admin: retry dispatch for an order stuck in delivery_unassigned. */
export const POST = api<{ params: { id: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  const orderId = Number(params.id);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.status !== 'delivery_unassigned') {
    throw new ApiError(409, 'Order is not waiting for a rider');
  }
  await retryDispatch(orderId);
  const [updated] = await db.select().from(orders).where(eq(orders.id, orderId));
  return ok({ order: updated });
});
