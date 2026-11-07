import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { markSessionMfaVerified, requireSession } from '@/lib/auth';
import { sendSecurityAlert } from '@/lib/auth/device';
import { hashRecoveryCode, verifyTotp } from '@/lib/auth/totp';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';
import { decryptBytes } from '@/lib/storage/files';

export const dynamic = 'force-dynamic';

/**
 * Login step 2 (and the re-auth for sensitive actions): a 6-digit authenticator code, or ONE recovery code.
 * A recovery code is consumed on use. Rate-limited per account.
 */
export async function checkSecondFactor(userId: number, code: string): Promise<'totp' | 'recovery'> {
  await rateLimit(`2fa:${userId}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.totpEnabledAt || !u.totpSecretEnc) throw new ApiError(409, 'Two-factor authentication is not set up');
  const trimmed = String(code ?? '').trim();
  if (/^\d{3}\s?\d{3}$/.test(trimmed)) {
    const secret = decryptBytes(Buffer.from(u.totpSecretEnc, 'base64')).toString();
    if (verifyTotp(secret, trimmed)) return 'totp';
  } else if (trimmed) {
    const h = hashRecoveryCode(trimmed);
    const codes = u.totpRecoveryHashesJson ?? [];
    if (codes.includes(h)) {
      const [claimed] = await db.update(users).set({ totpRecoveryHashesJson: codes.filter((c) => c !== h) }).where(eq(users.id, userId)).returning({ id: users.id });
      if (claimed) {
        await recordAudit({ actorId: userId, action: 'auth.recovery_code_used', targetType: 'user', targetId: userId, meta: { remaining: codes.length - 1 } });
        await sendSecurityAlert(userId, 'A two-factor recovery code was used');
        return 'recovery';
      }
    }
  }
  throw new ApiError(401, 'That code is wrong');
}

export const POST = api(async (req) => {
  const session = await requireSession(['admin'], { allowMfaPending: true });
  const { code } = await readJson<{ code: string }>(req);
  const kind = await checkSecondFactor(session.uid, code);
  await markSessionMfaVerified(session.sid);
  return ok({ ok: true, kind });
});
