import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { getDb } from '@/lib/db';
import { emailOutbox } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Dev/e2e only: reads the mock email outbox without logging in. 404 in production. */
export const GET = api(async (req) => {
  if (process.env.NODE_ENV === 'production') throw new ApiError(404, 'Not found');
  const to = req.nextUrl.searchParams.get('to')?.toLowerCase();
  const db = await getDb();
  const rows = await db
    .select()
    .from(emailOutbox)
    .where(to ? eq(emailOutbox.toEmail, to) : undefined)
    .orderBy(desc(emailOutbox.id))
    .limit(20);
  return ok({ emails: rows });
});
