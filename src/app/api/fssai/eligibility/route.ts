import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { checkEligibility } from '@/lib/fssai/assistant';
import { recordFunnel } from '@/lib/fssai/funnel';
import { getPlatformSettings } from '@/lib/db/platform';

export const dynamic = 'force-dynamic';

const schema = z.object({ sales: z.enum(['under_12l', '12l_to_20cr', 'above_20cr']), homeKitchen: z.boolean(), onlyTelangana: z.boolean() });

/** Step 1 of the assistant: which form does this kitchen need? Records the funnel stage. */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Answer all three questions');
  const result = checkEligibility(parsed.data);
  await recordFunnel(session.uid, 'started');
  if (result.route === 'form_a') await recordFunnel(session.uid, 'eligible');
  const settings = await getPlatformSettings();
  return ok({ result, feePerYearRupees: settings.fssaiBasicFeePerYear });
});
