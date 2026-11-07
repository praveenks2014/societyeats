import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { updatePlan } from '@/lib/meal-plans';

export const dynamic = 'force-dynamic';

/** The kitchen edits or pauses its own plan. Weeks already booked are not changed. */
export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller']);
  const parsed = z
    .object({ name: z.string().optional(), days: z.array(z.string()).optional(), slot: z.string().optional(), listingIds: z.array(z.number().int()).optional(), skipCutoffHours: z.number().int().nullable().optional(), active: z.boolean().optional() })
    .safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid plan');
  return ok({ plan: await updatePlan(session.uid, Number(params.id), parsed.data) });
});
