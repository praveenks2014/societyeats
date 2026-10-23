import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { funnelReport } from '@/lib/fssai/funnel';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  return ok(await funnelReport());
});
