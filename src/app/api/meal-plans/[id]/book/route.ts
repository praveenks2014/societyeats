import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { bookWeek } from '@/lib/meal-plans';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Book a week of a plan starting on a date (IST). One combined platform-fee payment; food is paid at the door each day. */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['buyer']);
  await rateLimit(`mealplan:${session.uid}`, { limit: 10, windowMs: 60 * 60 * 1000 });
  const parsed = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose the first day');
  return ok(await bookWeek(session.uid, Number(params.id), new Date(`${parsed.data.start}T00:00:00+05:30`)));
});
