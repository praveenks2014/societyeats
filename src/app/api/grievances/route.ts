import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { createGrievance } from '@/lib/grievances';
import { getDb } from '@/lib/db';
import { grievances, users } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['grievance', 'data_request']).default('grievance'),
  subject: z.string().trim().min(3, 'Add a short subject').max(200),
  body: z.string().trim().min(10, 'Tell us what happened (at least a sentence)').max(3000),
  orderId: z.number().int().positive().optional(),
});

/** A signed-in user raises a grievance or a data request. Acknowledged automatically; timers come from settings. */
export const POST = api(async (req) => {
  const session = await requireSession(['buyer', 'seller']);
  await rateLimit(`grievance:${session.uid}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const g = await createGrievance({ ...parsed.data, raisedById: session.uid, raisedRole: session.role === 'seller' ? 'seller' : 'buyer' });
  await notify(session.uid, `We received your ${parsed.data.kind === 'data_request' ? 'data request' : 'complaint'} (#${g.id})`, `We will acknowledge it within ${Math.round((g.ackDueAt.getTime() - g.createdAt.getTime()) / 3_600_000)} hours.`, '/legal/grievance');
  const db = await getDb();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  for (const a of admins) await notify(a.id, `New ${parsed.data.kind === 'data_request' ? 'data request' : 'grievance'} #${g.id}`, parsed.data.subject, '/admin/grievances');
  return ok({ id: g.id, ackDueAt: g.ackDueAt });
});

export const GET = api(async () => {
  const session = await requireSession(['buyer', 'seller']);
  const db = await getDb();
  const rows = await db.select().from(grievances).where(and(eq(grievances.raisedById, session.uid))).orderBy(desc(grievances.createdAt)).limit(20);
  return ok({ grievances: rows.map((g) => ({ id: g.id, kind: g.kind, subject: g.subject, status: g.status, createdAt: g.createdAt, ackDueAt: g.ackDueAt, resolveDueAt: g.resolveDueAt, resolution: g.resolution })) });
});
