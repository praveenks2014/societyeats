import { eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * `?live=1` restricts the list to societies open for new signups
 * (societies.isLive — DECISIONS.md #87+), used by the registration form.
 * Without it, every society is returned (unchanged) — the location picker
 * used for browsing isn't gated the way account creation is: existing
 * accounts in a not-yet-public society should still be able to browse/order.
 */
export const GET = api(async (req) => {
  const db = await getDb();
  const onlyLive = new URL(req.url).searchParams.get('live') === '1';
  const rows = onlyLive
    ? await db.select().from(societies).where(eq(societies.isLive, true))
    : await db.select().from(societies);
  return ok({ societies: rows });
});
