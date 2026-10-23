import { eq } from 'drizzle-orm';
import { api, ok, readJson } from '@/lib/api';
import { sendPasswordResetEmail } from '@/lib/auth/mail';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Always answers 200 so it cannot be used to discover which emails have accounts. */
export const POST = api(async (req) => {
  await rateLimit(`forgot:${clientIp(req)}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  const { identifier } = await readJson<{ identifier: string }>(req);
  const raw = (identifier || '').trim();
  const db = await getDb();
  const isEmail = raw.includes('@');
  const key = isEmail ? raw.toLowerCase() : raw.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (key) {
    await rateLimit(`forgot-id:${key}`, { limit: 3, windowMs: 15 * 60 * 1000 });
    const [u] = await db.select().from(users).where(isEmail ? eq(users.email, key) : eq(users.phone, key));
    if (u?.email && !u.blockedAt) await sendPasswordResetEmail(u.id);
  }
  return ok({ ok: true });
});
