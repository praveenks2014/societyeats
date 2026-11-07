import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { endSub } from '@/lib/meal-plans';

export const dynamic = 'force-dynamic';

/** The buyer pauses or cancels the rest of a booked week (days inside the skip cut-off stay). */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['buyer']);
  const parsed = z.object({ action: z.enum(['pause', 'cancel']) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose pause or cancel');
  return ok(await endSub(session.uid, Number(params.id), parsed.data.action === 'pause' ? 'paused' : 'cancelled'));
});
