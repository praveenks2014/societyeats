import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { plusMemberships } from '@/lib/db/schema';
import { activatePurchase } from '@/lib/plus';
import { verifyCheckoutSignature } from '@/lib/payments';

export const dynamic = 'force-dynamic';

/** Complete a Plus purchase: the mock sheet (mock mode only) or a verified Razorpay signature. */
export const POST = api(async (req) => {
  const session = await requireSession(['buyer']);
  const parsed = z.object({ membershipId: z.number().int(), mock: z.boolean().optional(), razorpay_payment_id: z.string().optional(), razorpay_signature: z.string().optional() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const db = await getDb();
  const [m] = await db.select().from(plusMemberships).where(eq(plusMemberships.id, parsed.data.membershipId));
  if (!m || m.userId !== session.uid) throw new ApiError(404, 'Purchase not found');
  let paymentId: string;
  if (parsed.data.mock) {
    if (!isMockMode()) throw new ApiError(400, 'Mock payments are off');
    paymentId = `pay_MOCKPLUS${m.id}`;
  } else {
    if (!m.razorpayOrderId || !parsed.data.razorpay_payment_id || !parsed.data.razorpay_signature || !verifyCheckoutSignature(m.razorpayOrderId, parsed.data.razorpay_payment_id, parsed.data.razorpay_signature)) throw new ApiError(400, 'Payment could not be verified');
    paymentId = parsed.data.razorpay_payment_id;
  }
  const won = await activatePurchase(m.id, paymentId);
  return ok({ active: !!won || m.status === 'active' });
});
