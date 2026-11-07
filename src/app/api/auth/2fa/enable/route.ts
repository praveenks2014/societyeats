import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { markSessionMfaVerified, requireSession } from '@/lib/auth';
import { sendSecurityAlert } from '@/lib/auth/device';
import { generateRecoveryCodes, hashRecoveryCode, verifyTotp } from '@/lib/auth/totp';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';
import { decryptBytes } from '@/lib/storage/files';

export const dynamic = 'force-dynamic';

/** Step 2: prove the authenticator works. Turns 2FA on, verifies this session, and returns the 10 recovery codes ONCE. */
export const POST = api(async (req) => {
  const session = await requireSession(['admin'], { allowMfaPending: true });
  await rateLimit(`2fa:${session.uid}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  const { code } = await readJson<{ code: string }>(req);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, session.uid));
  if (!u?.totpSecretEnc) throw new ApiError(409, 'Start the setup first');
  if (u.totpEnabledAt) throw new ApiError(409, 'Two-factor authentication is already on');
  const secret = decryptBytes(Buffer.from(u.totpSecretEnc, 'base64')).toString();
  if (!verifyTotp(secret, code)) throw new ApiError(400, 'That code is not right — check the time on your phone and try again');
  const recovery = generateRecoveryCodes();
  await db.update(users).set({ totpEnabledAt: new Date(), totpRecoveryHashesJson: recovery.map(hashRecoveryCode) }).where(eq(users.id, session.uid));
  await markSessionMfaVerified(session.sid);
  await recordAudit({ actorId: session.uid, action: 'auth.2fa_enabled', targetType: 'user', targetId: session.uid });
  await sendSecurityAlert(session.uid, 'Two-factor authentication was turned on');
  return ok({ ok: true, recoveryCodes: recovery });
});
