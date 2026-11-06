import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { users } from '@/lib/db/schema';

/**
 * Per-account lockout after N failed logins inside a window (defaults 10 in 15 minutes), with exponential back-off:
 * each further failure doubles the lock (15 min → 30 → 60 …, capped at 24 h). A successful login resets everything.
 * Separate from the IP/identifier rate limits, which stop guessing across accounts.
 */
export async function assertNotLocked(userId: number, now: Date = new Date()) {
  const db = await getDb();
  const [u] = await db.select({ lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, userId));
  if (u?.lockedUntil && u.lockedUntil.getTime() > now.getTime()) {
    const mins = Math.max(1, Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 60_000));
    throw new ApiError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`, 'locked');
  }
}

export async function recordFailedLogin(userId: number, now: Date = new Date()): Promise<{ locked: boolean; lockMinutes: number }> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return { locked: false, lockMinutes: 0 };
  const windowMs = settings.loginLockWindowMinutes * 60_000;
  const fresh = !u.failedLoginWindowStart || now.getTime() - u.failedLoginWindowStart.getTime() > windowMs;
  const count = (fresh ? 0 : u.failedLoginCount) + 1;
  const patch: Partial<typeof users.$inferInsert> = { failedLoginCount: count, failedLoginWindowStart: fresh ? now : u.failedLoginWindowStart };
  let lockMinutes = 0;
  if (count >= settings.loginLockMaxFailures) {
    lockMinutes = Math.min(settings.loginLockWindowMinutes * 2 ** (count - settings.loginLockMaxFailures), 24 * 60);
    patch.lockedUntil = new Date(now.getTime() + lockMinutes * 60_000);
  }
  await db.update(users).set(patch).where(eq(users.id, userId));
  return { locked: lockMinutes > 0, lockMinutes };
}

export async function clearFailedLogins(userId: number) {
  const db = await getDb();
  await db.update(users).set({ failedLoginCount: 0, failedLoginWindowStart: null, lockedUntil: null }).where(eq(users.id, userId));
}
