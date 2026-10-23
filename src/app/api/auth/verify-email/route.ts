import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { promoteIfAllowlisted } from '@/lib/auth/admins';
import { consumeToken } from '@/lib/auth/tokens';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  await rateLimit(`verify-email:${clientIp(req)}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  const { token } = await readJson<{ token: string }>(req);
  const userId = await consumeToken(token, 'verify');
  if (!userId) throw new ApiError(400, 'This verification link is invalid or has expired. Request a new one.');
  const db = await getDb();
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  const promoted = await promoteIfAllowlisted(db, userId);
  return ok({ ok: true, promoted });
});
