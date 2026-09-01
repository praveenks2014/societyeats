import { desc, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { payouts } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** This seller's own payout batches — same numbers the admin batch tool generated, seller-scoped. */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.sellerId, session.uid))
    .orderBy(desc(payouts.createdAt))
    .limit(30);
  return ok({ payouts: rows });
});
