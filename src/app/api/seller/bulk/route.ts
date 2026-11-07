import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { bulkRequests } from '@/lib/db/schema';
import { declineBulk, quoteBulk } from '@/lib/bulk';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  return ok({ requests: await db.select().from(bulkRequests).where(eq(bulkRequests.sellerId, session.uid)).orderBy(desc(bulkRequests.id)) });
});

export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = z.object({ id: z.number().int(), action: z.enum(['quote', 'decline']), items: z.array(z.object({ listingId: z.number().int(), qty: z.number().int() })).optional(), note: z.string().optional() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  if (parsed.data.action === 'decline') {
    await declineBulk(session.uid, parsed.data.id);
    return ok({ ok: true });
  }
  return ok(await quoteBulk(session.uid, parsed.data.id, parsed.data.items ?? [], parsed.data.note));
});
