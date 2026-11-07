import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { addPlacement, endPlacement } from '@/lib/featured';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const parsed = z.object({ sellerId: z.number().int(), societyId: z.number().int(), startsOn: z.string(), endsOn: z.string() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose a kitchen, a society and dates');
  return ok({ placement: await addPlacement(admin.uid, parsed.data) });
});

export const DELETE = api(async (req) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const parsed = z.object({ id: z.number().int() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose a placement');
  return ok({ placement: await endPlacement(admin.uid, parsed.data.id) });
});
