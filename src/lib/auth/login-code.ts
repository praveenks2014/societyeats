import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { BRAND } from '@/config/brand';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { loginCodes, users } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';

/**
 * "Email me a 6-digit code" login: 10-minute expiry, 5 attempts, SHA-256 hashed in the DB, one live code per email.
 * The request endpoint answers identically whether or not the email has an account (no account enumeration).
 */
const TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
const hash = (email: string, code: string) => crypto.createHash('sha256').update(`login-code:${email}:${code}`).digest('hex');

export async function issueLoginCode(emailRaw: string, now: Date = new Date()): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || u.blockedAt || u.anonymizedAt) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  // Only the newest code is valid.
  await db.update(loginCodes).set({ usedAt: now }).where(and(eq(loginCodes.email, email), isNull(loginCodes.usedAt)));
  await db.insert(loginCodes).values({ email, codeHash: hash(email, code), expiresAt: new Date(now.getTime() + TTL_MS) });
  await sendEmail({
    userId: u.id,
    to: email,
    kind: 'login_code',
    sensitive: true,
    subject: `Your ${BRAND.appName} sign-in code`,
    text: `Your sign-in code is ${code}\n\nIt works once and expires in 10 minutes. If you did not ask for it, ignore this email.\n\n— ${BRAND.appName}`,
  });
}

/** Returns the user id on success; every failure is the same generic error. */
export async function consumeLoginCode(emailRaw: string, codeRaw: string, now: Date = new Date()): Promise<number> {
  const email = emailRaw.trim().toLowerCase();
  const code = String(codeRaw ?? '').replace(/\s/g, '');
  const bad = () => new ApiError(401, 'That code is wrong or has expired');
  if (!/^\d{6}$/.test(code)) throw bad();
  const db = await getDb();
  const [row] = await db.select().from(loginCodes).where(and(eq(loginCodes.email, email), isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, now))).orderBy(desc(loginCodes.id)).limit(1);
  if (!row || row.attempts >= MAX_ATTEMPTS) throw bad();
  const ok = crypto.timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(hash(email, code)));
  if (!ok) {
    await db.update(loginCodes).set({ attempts: row.attempts + 1 }).where(eq(loginCodes.id, row.id));
    throw bad();
  }
  const [used] = await db.update(loginCodes).set({ usedAt: now }).where(and(eq(loginCodes.id, row.id), isNull(loginCodes.usedAt))).returning();
  if (!used) throw bad();
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || u.blockedAt) throw bad();
  return u.id;
}
