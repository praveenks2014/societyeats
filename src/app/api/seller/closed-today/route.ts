import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { DAY_MS, istStartOfDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** “Not taking orders today”: closes the kitchen to buyers until the next 00:00 IST, or reopens it now. Orders already accepted are unaffected. */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = z.object({ closed: z.boolean() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'closed must be true or false');
  const closedUntil = parsed.data.closed ? new Date(istStartOfDay().getTime() + DAY_MS) : null;
  const db = await getDb();
  const [row] = await db.update(sellerProfiles).set({ closedUntil }).where(eq(sellerProfiles.userId, session.uid)).returning({ closedUntil: sellerProfiles.closedUntil });
  if (!row) throw new ApiError(404, 'Seller profile missing');
  return ok({ closedUntil: row.closedUntil });
});
