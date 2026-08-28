import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { verifyFssaiLicense } from '@/lib/fssai/verify';

export const dynamic = 'force-dynamic';

/** "I have a license" path: verify the 14-digit number, badge the kitchen. */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const { licenseNumber } = await readJson<{ licenseNumber: string }>(req);
  const result = await verifyFssaiLicense(licenseNumber || '');
  if (!result.valid) throw new ApiError(400, result.reason);

  const db = await getDb();
  await db
    .update(sellerProfiles)
    .set({
      fssaiNumber: licenseNumber.replace(/\s/g, ''),
      fssaiStatus: 'verified',
      fssaiExpiry: result.expiresOn || null,
    })
    .where(eq(sellerProfiles.userId, session.uid));

  return ok({ ok: true, verification: result });
});
