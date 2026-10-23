import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { VPA_RE, paymentDetailsOk } from '@/lib/kitchen/gate';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    upiVpa: z.string().trim().max(80).nullish(),
    upiName: z.string().trim().max(120).nullish(),
    acceptsUpiNow: z.boolean(),
    acceptsPayAtPickup: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.acceptsUpiNow && !v.acceptsPayAtPickup) ctx.addIssue({ code: 'custom', message: 'Offer at least one way to get paid' });
    if (v.upiVpa && !VPA_RE.test(v.upiVpa)) ctx.addIssue({ code: 'custom', path: ['upiVpa'], message: 'Enter a valid UPI ID like name@bank' });
    if (v.acceptsUpiNow && !v.upiVpa) ctx.addIssue({ code: 'custom', path: ['upiVpa'], message: 'Add your UPI ID, or switch to pay-at-pickup only' });
    if (v.upiVpa && !v.upiName) ctx.addIssue({ code: 'custom', path: ['upiName'], message: 'Enter the name your UPI ID is registered to' });
  });

/**
 * Where buyers pay for FOOD. The platform never collects food money and never
 * stores bank account numbers or PAN — just a UPI ID (shown to a buyer only
 * inside their own order) and the name it belongs to.
 */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!p) throw new ApiError(404, 'Seller profile not found');
  return ok({ upiVpa: p.upiVpa, upiName: p.upiName, acceptsUpiNow: p.acceptsUpiNow, acceptsPayAtPickup: p.acceptsPayAtPickup, complete: paymentDetailsOk(p) });
});

export const PUT = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const v = parsed.data;
  const db = await getDb();
  await db
    .update(sellerProfiles)
    .set({ upiVpa: v.upiVpa || null, upiName: v.upiName || null, acceptsUpiNow: v.acceptsUpiNow, acceptsPayAtPickup: v.acceptsPayAtPickup })
    .where(eq(sellerProfiles.userId, session.uid));
  return ok({ ok: true });
});
