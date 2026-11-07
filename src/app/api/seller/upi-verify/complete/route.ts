import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { completeCheckoutVerification, completeMockVerification, pollRpdVerification } from '@/lib/upi-verify';

export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('mock'), verificationId: z.number().int(), outcome: z.enum(['success', 'failure', 'other_vpa', 'unreadable']) }),
  z.object({ mode: z.literal('razorpay'), verificationId: z.number().int(), razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }),
  z.object({ mode: z.literal('poll'), verificationId: z.number().int() }),
]);

export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const b = parsed.data;
  const row =
    b.mode === 'mock'
      ? await completeMockVerification(session.uid, b.verificationId, b.outcome)
      : b.mode === 'razorpay'
        ? await completeCheckoutVerification({ sellerId: session.uid, verificationId: b.verificationId, razorpay_order_id: b.razorpay_order_id, razorpay_payment_id: b.razorpay_payment_id, razorpay_signature: b.razorpay_signature })
        : await pollRpdVerification(session.uid, b.verificationId);
  return ok({ status: row.status, verifiedVpa: row.verifiedVpa ?? null, nameMatchScore: 'nameMatchScore' in row ? row.nameMatchScore ?? null : null });
});
