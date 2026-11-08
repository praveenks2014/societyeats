import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getPlatformSettings } from '@/lib/db/platform';
import { activePlus, startPurchase } from '@/lib/plus';
import { BRAND } from '@/config/brand';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['buyer']);
  const s = await getPlatformSettings();
  if (!s.plusEnabled) throw new ApiError(404, `${BRAND.name} Plus is not available`);
  const m = await activePlus(session.uid);
  return ok({ active: !!m, endsAt: m?.endsAt ?? null, pricePaise: s.plusPriceMonthlyPaise, discountBps: s.plusFeeDiscountBps, capPaise: s.plusMonthlyDiscountCapPaise });
});

/** Buy one month. Needs explicit consent; it never renews by itself. */
export const POST = api(async (req) => {
  const session = await requireSession(['buyer']);
  const parsed = z.object({ consent: z.boolean() }).safeParse(await readJson(req));
  return ok(await startPurchase(session.uid, !!parsed.success && parsed.data.consent));
});
