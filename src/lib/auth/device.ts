import { and, eq, sql } from 'drizzle-orm';
import { BRAND } from '@/config/brand';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { auditLog, users } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { deviceHashOf } from './index';

/** Records the login in the audit log and, when this is a device we have not seen for the account, emails an alert. */
export async function noteLoginAndAlert(userId: number, userAgent: string | null, ip: string | null): Promise<boolean> {
  const db = await getDb();
  const hash = deviceHashOf(userAgent);
  const [{ seenBefore, any }] = await db
    .select({
      seenBefore: sql<number>`count(*) filter (where ${auditLog.meta}->>'deviceHash' = ${hash})::int`,
      any: sql<number>`count(*)::int`,
    })
    .from(auditLog)
    .where(and(eq(auditLog.actorId, userId), eq(auditLog.action, 'auth.login')));
  await recordAudit({ actorId: userId, action: 'auth.login', targetType: 'user', targetId: userId, meta: { deviceHash: hash, ip } });
  if (any === 0 || seenBefore > 0) return false;
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.email) return false;
  await sendEmail({
    userId,
    to: u.email,
    kind: 'new_device_login',
    sensitive: true,
    subject: `New sign-in to your ${BRAND.appName} account`,
    text: `We noticed a sign-in from a device we have not seen before.\n\nDevice: ${userAgent ?? 'unknown'}\nWhen: ${new Date().toUTCString()}\n\nIf this was you, nothing to do. If not, change your password and use "Log out of all devices" in your account page right away.\n\n— ${BRAND.appName}`,
  });
  return true;
}

export async function sendSecurityAlert(userId: number, what: string): Promise<void> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.email) return;
  await sendEmail({
    userId,
    to: u.email,
    kind: 'security_alert',
    sensitive: true,
    subject: `${BRAND.appName}: ${what}`,
    text: `${what}.\n\nIf you did not do this, change your password immediately and use "Log out of all devices" in your account page.\n\n— ${BRAND.appName}`,
  });
}
