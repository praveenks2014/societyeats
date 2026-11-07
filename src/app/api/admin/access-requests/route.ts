import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { societyAccessRequests } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  return ok({ requests: await db.select().from(societyAccessRequests).orderBy(societyAccessRequests.createdAt) });
});

const schema = z.object({ id: z.number().int(), status: z.enum(['open', 'contacted', 'closed']) });
export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const db = await getDb();
  await db.update(societyAccessRequests).set({ status: parsed.data.status }).where(eq(societyAccessRequests.id, parsed.data.id));
  return ok({ ok: true });
});
