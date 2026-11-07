import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getMenuPost, publishMenu, shareLink } from '@/lib/menu-posts';
import { siteOriginSafe } from '@/lib/site-url';
import { rateLimit } from '@/lib/rate-limit';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

async function withShare(sellerId: number) {
  const m = await getMenuPost(sellerId);
  if (!m) return { post: null };
  const db = await getDb();
  const [k] = await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  const url = `${await siteOriginSafe()}/menu/${m.post.id}`;
  return { post: { id: m.post.id, forDate: m.post.forDate, note: m.post.note, listingIds: m.post.listingIdsJson, dishes: m.dishes.map((d) => d.title) }, share: { url, ...shareLink({ kitchen: k?.name ?? 'Your neighbour', dishes: m.dishes.map((d) => d.title), note: m.post.note, url }) } };
}

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  return ok(await withShare(session.uid));
});

/** Publish today's menu: it feeds the share card and tells followers who asked for “cooking” alerts. */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  await rateLimit(`menu:${session.uid}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  const parsed = z.object({ listingIds: z.array(z.number().int()).min(1).max(12), note: z.string().max(200).optional() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose the dishes for today');
  const r = await publishMenu(session.uid, parsed.data);
  return ok({ alerted: r.alerted, ...(await withShare(session.uid)) });
});
