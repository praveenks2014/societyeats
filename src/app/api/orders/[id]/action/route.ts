import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { performOrderAction } from '@/lib/orders/actions';
import { applyOrderTimers } from '@/lib/orders/lifecycle';
import { viewerActor } from '@/lib/orders/view';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const ACTIONS = [
  'accept', 'preparing', 'ready', 'on_the_way', 'reached_door', 'buyer_arrived', 'collect', 'claim_paid', 'confirm_paid',
  'not_received', 'raise_dispute', 'resolve_paid', 'resolve_unpaid', 'buyer_couldnt_pay', 'no_show', 'seller_cancel', 'buyer_cancel', 'admin_cancel',
] as const;

const schema = z.object({
  action: z.enum(ACTIONS),
  reason: z.string().trim().max(300).optional(),
  method: z.enum(['upi', 'cash']).optional(),
  utr: z.string().trim().max(20).optional().or(z.literal('')),
  credit: z.boolean().optional(),
});

/**
 * Every order step, for every role, goes through here. The actor is derived from the session's relation to the
 * order (buyer / kitchen / admin) — never from the request body — and the state machine decides whether the
 * move is legal.
 */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  if (!Number.isInteger(orderId)) throw new ApiError(404, 'Order not found');
  await rateLimit(`order-action:${session.uid}`, { limit: 60, windowMs: 5 * 60 * 1000 });
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new ApiError(404, 'Order not found');
  const actor = viewerActor(order, { uid: session.uid, role: session.role });
  if (!actor) throw new ApiError(403, 'Not your order');
  if (actor === 'admin') requireRecentMfa(session); // an admin moving an order (resolve, cancel) needs a fresh 2FA check
  await applyOrderTimers(orderId);
  const r = await performOrderAction(orderId, { ...parsed.data, actor, actorId: session.uid, utr: parsed.data.utr || undefined });
  return ok({ ok: true, ...r });
});
