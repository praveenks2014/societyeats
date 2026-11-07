import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { mealPlans } from '@/lib/db/schema';
import { createPlan, mySubs } from '@/lib/meal-plans';
import { getPlatformSettings } from '@/lib/db/platform';

export const dynamic = 'force-dynamic';

/** Plans of one kitchen (?sellerId=) for a buyer, plus the buyer's own booked weeks. */
export const GET = api(async (req) => {
  const session = await requireSession(['buyer', 'seller']);
  if (!(await getPlatformSettings()).mealPlansEnabled) throw new ApiError(404, 'Meal plans are not available');
  const sellerId = Number(req.nextUrl.searchParams.get('sellerId')) || session.uid;
  const db = await getDb();
  return ok({ plans: await db.select().from(mealPlans).where(and(eq(mealPlans.sellerId, sellerId), eq(mealPlans.active, true))), mine: await mySubs(session.uid) });
});

export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = z.object({ name: z.string(), days: z.array(z.string()), slot: z.enum(['breakfast', 'lunch', 'dinner']), listingIds: z.array(z.number().int()) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Fill in the plan');
  return ok({ plan: await createPlan(session.uid, parsed.data) });
});
