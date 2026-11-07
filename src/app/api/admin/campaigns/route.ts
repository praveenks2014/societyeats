import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { createCampaign, listCampaigns } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  return ok({ campaigns: await listCampaigns() });
});

export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const parsed = z.object({ slug: z.string(), title: z.string(), body: z.string(), startsOn: z.string(), endsOn: z.string(), sellerIds: z.array(z.number().int()).max(50) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Fill in the campaign');
  return ok({ campaign: await createCampaign(admin.uid, parsed.data) });
});
