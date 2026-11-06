import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { destroyCurrentSession, requireSession, verifyPassword } from '@/lib/auth';
import { deleteAccount } from '@/lib/account';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Needs the password and the word DELETE. Refused while an order is open. Admin accounts cannot self-delete. */
export const POST = api(async (req) => {
  const session = await requireSession(undefined, { allowMustChange: true });
  if (session.role === 'admin') throw new ApiError(403, 'Admin accounts are managed through the ADMIN_EMAILS setting');
  await rateLimit(`delete-account:${session.uid}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  const { password, confirm } = await readJson<{ password: string; confirm: string }>(req);
  if (confirm !== 'DELETE') throw new ApiError(400, 'Type DELETE to confirm');
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, session.uid));
  if (!u || !(await verifyPassword(password || '', u.passwordHash))) throw new ApiError(400, 'Password is wrong');
  await deleteAccount(session.uid);
  await destroyCurrentSession();
  return ok({ ok: true });
});
