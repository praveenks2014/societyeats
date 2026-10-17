import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { revokeAllSessions } from '@/lib/auth';
import { hashPassword, validatePassword } from '@/lib/auth/passwords';
import { consumeToken } from '@/lib/auth/tokens';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  await rateLimit(`reset:${clientIp(req)}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  const { token, password } = await readJson<{ token: string; password: string }>(req);
  const pwError = validatePassword(password);
  if (pwError) throw new ApiError(400, pwError);
  const userId = await consumeToken(token, 'reset');
  if (!userId) throw new ApiError(400, 'This reset link is invalid or has expired. Request a new one.');
  const db = await getDb();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: false })
    .where(eq(users.id, userId));
  await revokeAllSessions(userId);
  return ok({ ok: true });
});
