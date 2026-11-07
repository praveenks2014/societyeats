import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getPlatformSettings } from '@/lib/db/platform';
import { createPlan, mySubs, sellerPlans } from '@/lib/meal-plans';

export const dynamic = 'force-dynamic';

/** `?sellerId=` → that kitchen's live plans (buyers); `?mine=1` → the signed-in kitchen's own plans, paused ones too. Also returns the buyer's own booked weeks. */
export const GET = api(async (req) => {
  const session = await requireSession(['buyer', 'seller']);
  if (!(await getPlatformSettings()).mealPlansEnabled) throw new ApiError(404, 'Meal plans are not available');
  const mine = req.nextUrl.searchParams.get('mine') === '1' && session.role === 'seller';
  const sellerId = mine ? session.uid : Number(req.nextUrl.searchParams.get('sellerId')) || session.uid;
  const plans = (await sellerPlans(sellerId)).filter((p) => mine || p.active);
  return ok({ plans, mine: session.role === 'buyer' ? await mySubs(session.uid) : [], skipCutoffHours: (await getPlatformSettings()).mealPlanSkipCutoffHours });
});

export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = z.object({ name: z.string(), days: z.array(z.string()), slot: z.enum(['breakfast', 'lunch', 'dinner']), listingIds: z.array(z.number().int()) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Fill in the plan');
  return ok({ plan: await createPlan(session.uid, parsed.data) });
});
