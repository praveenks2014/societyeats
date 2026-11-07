import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grievances, societyAccessRequests, users } from '@/lib/db/schema';
import { slaOf } from '@/lib/disputes';

export const dynamic = 'force-dynamic';

/**
 * The one ticket list: complaints, chat reports, payment/food disputes, data requests, strike appeals — and access requests from
 * societies outside the pilot (shown alongside, resolved on the Societies page).
 */
export const GET = api(async (req) => {
  const admin = await requireSession(['admin']);
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind');
  const status = sp.get('status') ?? 'active';
  const mine = sp.get('mine') === '1';
  const db = await getDb();
  const conds: SQL[] = [];
  if (kind && kind !== 'all' && kind !== 'access_request') conds.push(eq(grievances.kind, kind));
  if (status === 'active') conds.push(inArray(grievances.status, ['open', 'acknowledged']));
  else if (status !== 'all') conds.push(eq(grievances.status, status));
  if (mine) conds.push(eq(grievances.handledBy, admin.uid));
  const rows = kind === 'access_request' ? [] : await db.select({ g: grievances, raiser: users.name }).from(grievances).leftJoin(users, eq(users.id, grievances.raisedById)).where(conds.length ? and(...conds) : undefined).orderBy(desc(grievances.createdAt)).limit(300);
  const now = new Date();
  const tickets = rows.map(({ g, raiser }) => ({ id: g.id, kind: g.kind, subject: g.subject, status: g.status, orderId: g.orderId, raiser: raiser ?? 'system', handledBy: g.handledBy, createdAt: g.createdAt, ackDueAt: g.ackDueAt, resolveDueAt: g.resolveDueAt, ...slaOf(g, now) }));
  const access = !kind || kind === 'all' || kind === 'access_request'
    ? (await db.select().from(societyAccessRequests).where(status === 'active' ? inArray(societyAccessRequests.status, ['open', 'contacted']) : undefined).orderBy(desc(societyAccessRequests.createdAt)).limit(100)).map((a) => ({ id: a.id, societyName: a.societyName, city: a.city, contactName: a.contactName, email: a.email, status: a.status, createdAt: a.createdAt }))
    : [];
  const admins = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, 'admin'));
  return ok({ tickets, accessRequests: access, admins, overdue: tickets.filter((t) => t.ackOverdue || t.resolveOverdue).length, me: admin.uid });
});
