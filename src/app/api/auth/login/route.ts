import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { createSession, verifyPassword } from '@/lib/auth';
import { effectiveRole, promoteIfAllowlisted } from '@/lib/auth/admins';
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
  if (!user || !(await verifyPassword(body.password || '', user.passwordHash))) {
    throw new ApiError(401, 'Wrong email/phone or password');
  }
  if (user.blockedAt) throw new ApiError(403, 'This account has been blocked. Contact support.');
  await promoteIfAllowlisted(db, user.id);
  await createSession(user.id);
  return ok({
    ok: true,
    role: effectiveRole(user),
    mustChangePassword: user.mustChangePassword,
    emailVerified: !!user.emailVerifiedAt,
  });
});
