import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { assertSellerAccess } from '@/lib/access';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';
import { latestVerification, startUpiVerification } from '@/lib/upi-verify';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  const v = await latestVerification(session.uid);
  return ok({
    status: p?.upiVerifyStatus ?? 'unverified',
    vpa: p?.upiVpa ?? null,
    verifiedVpa: p?.upiVerifiedVpa ?? null,
    registeredName: p?.upiVerifiedName ?? null,
    verification: v ? { id: v.id, status: v.status, provider: v.provider, verifiedVpa: v.verifiedVpa, nameMatchScore: v.nameMatchScore } : null,
  });
});

/** Starts the ₹1 ownership check for the saved UPI ID. */
export const POST = api(async () => {
  const session = await requireSession(['seller']);
  await assertSellerAccess(session.uid);
  await rateLimit(`upi-verify:${session.uid}`, { limit: 6, windowMs: 60 * 60 * 1000 });
  return ok(await startUpiVerification(session.uid));
});
