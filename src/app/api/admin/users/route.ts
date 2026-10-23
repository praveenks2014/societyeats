import { desc, ilike, or, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { societies, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession(['admin']);
  const q = req.nextUrl.searchParams.get('q')?.trim();
  const db = await getDb();
  const like = q ? `%${q.replace(/[%_]/g, '')}%` : null;
  const rows = await db
    .select({ id: users.id, name: users.name, phone: users.phone, email: users.email, role: users.role, blockedAt: users.blockedAt, emailVerifiedAt: users.emailVerifiedAt, approvalStatus: users.approvalStatus, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt, society: societies.name })
    .from(users)
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(like ? or(ilike(users.name, like), ilike(users.phone, like), ilike(users.email, like)) : undefined)
    .orderBy(desc(users.id))
    .limit(100);
  return ok({ users: rows });
});
