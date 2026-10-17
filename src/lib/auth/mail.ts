import { BRAND } from '@/config/brand';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmail } from '@/lib/email';
import { siteOriginSafe } from '@/lib/site-url';
import { issueToken } from './tokens';

export async function sendVerificationEmail(userId: number): Promise<void> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.email || u.emailVerifiedAt) return;
  const token = await issueToken(u.id, 'verify');
  const link = `${siteOriginSafe()}/verify-email?token=${token}`;
  await sendEmail({
    userId: u.id,
    to: u.email,
    kind: 'verify_email',
    sensitive: true,
    subject: `Verify your email for ${BRAND.appName}`,
    text: `Hi ${u.name},\n\nConfirm your email address to finish setting up your ${BRAND.appName} account:\n${link}\n\nThis link works once and expires in 24 hours. If you did not sign up, ignore this email.\n\n— ${BRAND.appName}`,
  });
}

export async function sendPasswordResetEmail(userId: number): Promise<void> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.email) return;
  const token = await issueToken(u.id, 'reset');
  const link = `${siteOriginSafe()}/reset-password?token=${token}`;
  await sendEmail({
    userId: u.id,
    to: u.email,
    kind: 'reset_password',
    sensitive: true,
    subject: `Reset your ${BRAND.appName} password`,
    text: `Hi ${u.name},\n\nUse this link to choose a new password:\n${link}\n\nIt works once and expires in 30 minutes. If you did not ask for this, you can ignore it — your password has not changed.\n\n— ${BRAND.appName}`,
  });
}
