import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordFunnel } from '@/lib/fssai/funnel';

export const dynamic = 'force-dynamic';

/** Client-observable stages only (the rest are recorded by the server when the action happens). */
const schema = z.object({ stage: z.enum(['pack_downloaded']) });

export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Unknown stage');
  await recordFunnel(session.uid, parsed.data.stage);
  return ok({ ok: true });
});
