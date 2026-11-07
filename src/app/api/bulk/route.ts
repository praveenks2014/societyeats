import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { bulkRequests } from '@/lib/db/schema';
import { requestBulk } from '@/lib/bulk';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['buyer']);
  const db = await getDb();
  return ok({ requests: await db.select().from(bulkRequests).where(eq(bulkRequests.buyerId, session.uid)).orderBy(desc(bulkRequests.id)) });
});

export const POST = api(async (req) => {
  const session = await requireSession(['buyer']);
  const parsed = z.object({ sellerId: z.number().int(), description: z.string(), portions: z.number().int(), forDate: z.string() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Fill in the request');
  return ok({ request: await requestBulk(session.uid, parsed.data) });
});
