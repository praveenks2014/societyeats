import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { skipDay } from '@/lib/meal-plans';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  const session = await requireSession(['buyer']);
  const parsed = z.object({ orderId: z.number().int() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose a day');
  return ok(await skipDay(session.uid, parsed.data.orderId));
});
