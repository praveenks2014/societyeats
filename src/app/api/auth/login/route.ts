import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { createSessionCookie, verifyPassword } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  // pre-auth: keyed by IP, generous enough for typos but not credential stuffing
  rateLimit(`login:${clientIp(req)}`, { limit: 10, windowMs: 5 * 60 * 1000 });
  const body = await readJson<{ phone: string; password: string }>(req);
  const phone = (body.phone || '').replace(/\D/g, '');
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.phone, phone));
  if (!user || !(await verifyPassword(body.password || '', user.passwordHash))) {
    throw new ApiError(401, 'Wrong phone number or password');
  }
  await createSessionCookie({ uid: user.id, role: user.role, name: user.name, phone: user.phone });
  return ok({ ok: true, role: user.role });
});
