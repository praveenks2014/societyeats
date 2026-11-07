import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strikes } from '@/lib/db/schema';
import { createGrievance } from '@/lib/grievances';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** The person a strike was issued to appeals it once; the appeal becomes a ticket with its own deadlines. */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['buyer', 'seller']);
  await rateLimit(`appeal:${session.uid}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  const parsed = z.object({ reason: z.string().trim().min(10, 'Tell us why (at least a sentence)').max(1500) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const id = Number(params.id);
  const db = await getDb();
  const [strike] = await db.select().from(strikes).where(and(eq(strikes.id, id), eq(strikes.userId, session.uid), isNull(strikes.liftedAt)));
  if (!strike) throw new ApiError(404, 'Strike not found');
  if (strike.appealedAt) throw new ApiError(409, 'You have already appealed this strike');
  await db.update(strikes).set({ appealedAt: new Date() }).where(eq(strikes.id, id));
  const g = await createGrievance({ kind: 'strike_appeal', orderId: strike.orderId, raisedById: session.uid, raisedRole: session.role === 'seller' ? 'seller' : 'buyer', subject: `Appeal of strike #${id} (${strike.kind.replaceAll('_', ' ')})`, body: parsed.data.reason, evidence: { strikeId: id, kind: strike.kind } });
  return ok({ id: g.id });
});
