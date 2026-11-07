import { eq } from 'drizzle-orm';
import { api, ok, readJson } from '@/lib/api';
import { createSession } from '@/lib/auth';
import { effectiveRole, promoteIfAllowlisted } from '@/lib/auth/admins';
import { noteLoginAndAlert } from '@/lib/auth/device';
import { assertNotLocked, clearFailedLogins, recordFailedLogin } from '@/lib/auth/lockout';
import { consumeLoginCode } from '@/lib/auth/login-code';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  const { email, code } = await readJson<{ email: string; code: string }>(req);
  const e = String(email ?? '').trim().toLowerCase();
  await rateLimit(`login-code-verify-ip:${clientIp(req)}`, { limit: 20, windowMs: 15 * 60 * 1000 });
  await rateLimit(`login-code-verify:${e}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, e));
  if (existing) await assertNotLocked(existing.id);
  let userId: number;
  try {
    userId = await consumeLoginCode(e, code);
  } catch (err) {
    if (existing) await recordFailedLogin(existing.id);
    throw err;
  }
  await clearFailedLogins(userId);
  // The code went to that inbox, so it also proves the address.
  await db.update(users).set({ emailVerifiedAt: existing?.emailVerifiedAt ?? new Date() }).where(eq(users.id, userId));
  await promoteIfAllowlisted(db, userId);
  await createSession(userId);
  await noteLoginAndAlert(userId, req.headers.get('user-agent'), clientIp(req));
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const role = effectiveRole(u);
  return ok({ ok: true, role, mustChangePassword: u.mustChangePassword, mfa: role === 'admin' ? (u.totpEnabledAt ? 'required' : 'enroll') : null });
});
