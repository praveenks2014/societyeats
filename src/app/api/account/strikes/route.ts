import { and, desc, eq, isNull } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strikes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** The signed-in person's own active strikes (so they can appeal one). */
export const GET = api(async () => {
  const session = await requireSession(['buyer', 'seller']);
  const db = await getDb();
  const rows = await db.select().from(strikes).where(and(eq(strikes.userId, session.uid), isNull(strikes.liftedAt))).orderBy(desc(strikes.createdAt)).limit(20);
  return ok({ strikes: rows.map((r) => ({ id: r.id, kind: r.kind, reason: r.reason, createdAt: r.createdAt, appealed: !!r.appealedAt })) });
});
