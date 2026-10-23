import { and, eq, ne } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession, verifyPassword } from '@/lib/auth';
import { hashPassword, validatePassword } from '@/lib/auth/passwords';
import { getDb } from '@/lib/db';
import { sessions, users } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  const session = await requireSession(undefined, { allowMustChange: true });
  await rateLimit(`chpw:${session.uid}`, { limit: 8, windowMs: 15 * 60 * 1000 });
  const { current, next } = await readJson<{ current: string; next: string }>(req);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, session.uid));
  if (!u || !(await verifyPassword(current || '', u.passwordHash))) throw new ApiError(400, 'Current password is wrong');
  const pwError = validatePassword(next, { phone: u.phone, email: u.email ?? undefined });
  if (pwError) throw new ApiError(400, pwError);
  if (current === next) throw new ApiError(400, 'Choose a different password from the current one');
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, u.id));
  // Sign out every other device.
  await db.delete(sessions).where(and(eq(sessions.userId, u.id), ne(sessions.id, session.sid)));
  return ok({ ok: true });
});
