import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { payouts } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Mark a pending payout as paid, recording the UTR reference from the manual bank/UPI transfer. */
export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  await requireSession(['admin']);
  const { utrReference } = await readJson<{ utrReference: string }>(req);
  if (!utrReference?.trim()) throw new ApiError(400, 'UTR reference is required');

  const db = await getDb();
  const payoutId = Number(params.id);
  const [payout] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!payout) throw new ApiError(404, 'Payout not found');
  if (payout.status === 'paid') throw new ApiError(409, 'Already marked paid');

  const [updated] = await db
    .update(payouts)
    .set({ status: 'paid', paidAt: new Date(), utrReference: utrReference.trim() })
    .where(eq(payouts.id, payoutId))
    .returning();
  return ok({ payout: updated });
});
