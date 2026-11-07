import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { metricsOverview } from '@/lib/metrics-overview';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession(['admin']);
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30);
  if (![7, 14, 30, 60, 90].includes(days)) throw new ApiError(400, 'Choose 7, 14, 30, 60 or 90 days');
  return ok(await metricsOverview(days));
});
