import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { createSession, verifyPassword } from '@/lib/auth';
import { effectiveRole, promoteIfAllowlisted } from '@/lib/auth/admins';
import { noteLoginAndAlert } from '@/lib/auth/device';
import { assertNotLocked, clearFailedLogins, recordFailedLogin } from '@/lib/auth/lockout';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  // pre-auth: keyed by IP, generous enough for typos but not credential stuffing
  await rateLimit(`login:${clientIp(req)}`, { limit: 10, windowMs: 5 * 60 * 1000 });
  const body = await readJson<{ identifier?: string; phone?: string; email?: string; password: string }>(req);
  const raw = (body.identifier ?? body.email ?? body.phone ?? '').trim();
  const isEmail = raw.includes('@');
  const key = isEmail ? raw.toLowerCase() : raw.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!key) throw new ApiError(400, 'Enter your email or phone number');
  // Per-identifier limit stops a distributed guessing attack on one account.
  await rateLimit(`login-id:${key}`, { limit: 15, windowMs: 15 * 60 * 1000 });
  const db = await getDb();
  const [user] = await db.select().from(users).where(isEmail ? eq(users.email, key) : eq(users.phone, key));
  if (user) await assertNotLocked(user.id);
  if (!user || user.anonymizedAt || !(await verifyPassword(body.password || '', user.passwordHash))) {
    if (user) {
      const r = await recordFailedLogin(user.id);
      if (r.locked) throw new ApiError(429, `Too many failed attempts. Try again in ${r.lockMinutes} minutes, or reset your password.`, 'locked');
    }
    throw new ApiError(401, 'Wrong email/phone or password');
  }
  if (user.blockedAt) throw new ApiError(403, 'This account has been blocked. Contact support.');
  await clearFailedLogins(user.id);
  await promoteIfAllowlisted(db, user.id);
  await createSession(user.id);
  await noteLoginAndAlert(user.id, req.headers.get('user-agent'), clientIp(req));
  const role = effectiveRole(user);
  return ok({
    ok: true,
    role,
    mustChangePassword: user.mustChangePassword,
    emailVerified: !!user.emailVerifiedAt,
    // Admins must pass TOTP (or enrol) before the admin area opens.
    mfa: role === 'admin' ? (user.totpEnabledAt ? 'required' : 'enroll') : null,
  });
});
