import { eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { generateTotpSecret, otpauthUri } from '@/lib/auth/totp';
import { BRAND } from '@/config/brand';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { encryptBytes } from '@/lib/storage/files';
import { upiQrSvg } from '@/lib/upi';

export const dynamic = 'force-dynamic';

/** Step 1 of enrolment: a fresh secret is stored (encrypted, not yet active) and shown once as text + QR. */
export const POST = api(async () => {
  const session = await requireSession(['admin'], { allowMfaPending: true });
  if (session.totpEnabled) throw new ApiError(409, 'Two-factor authentication is already on for this account');
  const secret = generateTotpSecret();
  const db = await getDb();
  await db.update(users).set({ totpSecretEnc: encryptBytes(Buffer.from(secret)).toString('base64') }).where(eq(users.id, session.uid));
  const uri = otpauthUri(session.email ?? `user${session.uid}`, secret, BRAND.appName);
  return ok({ secret, uri, qrSvg: await upiQrSvg(uri) });
});
