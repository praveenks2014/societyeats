import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const schema = z.object({ endpoint: z.string().url().max(1000).startsWith('https://'), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });

/** Save this browser's push subscription for the signed-in user (re-subscribing moves it to the current user). */
export const POST = api(async (req) => {
  const session = await requireSession(['buyer', 'seller']);
  await rateLimit(`push-sub:${session.uid}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid subscription');
  const { endpoint, keys } = parsed.data;
  const db = await getDb();
  await db.insert(pushSubscriptions).values({ userId: session.uid, endpoint, p256dh: keys.p256dh, auth: keys.auth }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: session.uid, p256dh: keys.p256dh, auth: keys.auth } });
  return ok({ ok: true });
});

export const DELETE = api(async (req) => {
  const session = await requireSession(['buyer', 'seller']);
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const db = await getDb();
  const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  // Only the owner may remove a subscription.
  if (rows[0] && rows[0].userId === session.uid) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  return ok({ ok: true });
});
