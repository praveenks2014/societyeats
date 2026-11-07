import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { VPA_RE, paymentDetailsOk } from '@/lib/kitchen/gate';
import { onUpiIdChanged } from '@/lib/upi-verify';

export const dynamic = 'force-dynamic';

const schema = z.object({
  upiVpa: z.string().trim().max(80).regex(VPA_RE, 'Enter a valid UPI ID like name@bank'),
  acceptsCash: z.boolean().optional(),
});

/**
 * Where buyers pay for FOOD: at their door, by UPI to the ID verified with the ₹1 check. The platform never
 * collects food money and never stores bank account numbers. Changing the UPI ID un-verifies it, which pauses
 * the kitchen until the new one passes the ₹1 check.
 */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!p) throw new ApiError(404, 'Seller profile not found');
  return ok({ upiVpa: p.upiVpa, acceptsCash: p.acceptsCash, verifyStatus: p.upiVerifyStatus, verifiedVpa: p.upiVerifiedVpa, registeredName: p.upiVerifiedName, complete: paymentDetailsOk(p) });
});

export const PUT = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const v = parsed.data;
  const db = await getDb();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!p) throw new ApiError(404, 'Seller profile not found');
  if (v.acceptsCash !== undefined) await db.update(sellerProfiles).set({ acceptsCash: v.acceptsCash }).where(eq(sellerProfiles.userId, session.uid));
  const changed = (p.upiVpa ?? '').toLowerCase() !== v.upiVpa.toLowerCase();
  if (changed) await onUpiIdChanged(session.uid, v.upiVpa);
  return ok({ ok: true, needsVerification: changed || p.upiVerifyStatus !== 'verified' });
});
