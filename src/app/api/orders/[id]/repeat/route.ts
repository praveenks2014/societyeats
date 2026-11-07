import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { repeatCart } from '@/lib/repeat';

export const dynamic = 'force-dynamic';

/** The cart for “order this again” at today's prices and availability. The buyer still checks out normally. */
export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession(['buyer', 'seller']);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new ApiError(404, 'Order not found');
  return ok(await repeatCart(id, session.uid));
});
