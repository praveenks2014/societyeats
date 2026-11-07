import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { societies, societyMemberships, users } from '@/lib/db/schema';
import { decideMembership, removeMember } from '@/lib/membership';

export const dynamic = 'force-dynamic';

/** Members of every society (filter with ?societyId= and ?status=). Phone numbers are not included. */
export const GET = api(async (req) => {
  await requireSession(['admin']);
  const societyId = Number(req.nextUrl.searchParams.get('societyId')) || null;
  const status = req.nextUrl.searchParams.get('status');
  const db = await getDb();
  const rows = await db
    .select({ id: societyMemberships.id, userId: users.id, name: users.name, role: users.role, tower: societyMemberships.tower, flat: societyMemberships.flat, status: societyMemberships.status, society: societies.name, societyId: societies.id, createdAt: societyMemberships.createdAt })
    .from(societyMemberships)
    .innerJoin(users, eq(societyMemberships.userId, users.id))
    .innerJoin(societies, eq(societyMemberships.societyId, societies.id))
    .where(and(societyId ? eq(societyMemberships.societyId, societyId) : undefined, status ? eq(societyMemberships.status, status) : undefined))
    .orderBy(societyMemberships.createdAt)
    .limit(500);
  return ok({ members: rows });
});

const schema = z.object({ membershipId: z.number().int(), action: z.enum(['approve', 'reject', 'remove']) });

export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const { membershipId, action } = parsed.data;
  if (action === 'remove') await removeMember(membershipId, admin.uid);
  else await decideMembership(membershipId, admin.uid, action);
  return ok({ ok: true });
});
