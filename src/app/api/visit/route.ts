import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ok, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { recordVisit } from '@/lib/visits';

export const dynamic = 'force-dynamic';

/** Anonymous visit beacon (once per browser session). Optional society invite code attributes it to that society's invite page. */
export const POST = api(async (req) => {
  await rateLimit(`visit:${clientIp(req)}`, { limit: 30, windowMs: 60 * 60 * 1000 });
  const parsed = z.object({ code: z.string().trim().max(40).optional() }).safeParse(await readJson(req).catch(() => ({})));
  let societyId = 0;
  if (parsed.success && parsed.data.code) {
    const db = await getDb();
    const [soc] = await db.select({ id: societies.id }).from(societies).where(eq(societies.inviteCode, parsed.data.code));
    if (soc) societyId = soc.id;
  }
  await recordVisit(societyId);
  return ok({ ok: true });
});
