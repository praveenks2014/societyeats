import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { acceptBulk, declineBulk } from '@/lib/bulk';

export const dynamic = 'force-dynamic';

/** Buyer: accept the quote (creates the scheduled order; the fee is paid on the order page) or cancel the request. */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['buyer']);
  const parsed = z.object({ action: z.enum(['accept', 'cancel']) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  if (parsed.data.action === 'accept') return ok(await acceptBulk(session.uid, Number(params.id)));
  await declineBulk(session.uid, Number(params.id));
  return ok({ ok: true });
});
