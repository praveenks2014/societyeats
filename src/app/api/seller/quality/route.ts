import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { qualityScore } from '@/lib/quality';

export const dynamic = 'force-dynamic';

/** The kitchen's own quality numbers (last 30 days) and what stands between it and the public Top Kitchen badge. */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  return ok(await qualityScore(session.uid));
});
