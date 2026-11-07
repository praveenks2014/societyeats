import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { disputeBoard } from '@/lib/disputes';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession(['admin']);
  const sp = req.nextUrl.searchParams;
  return ok(await disputeBoard({ societyId: Number(sp.get('societyId')) || undefined, sellerId: Number(sp.get('sellerId')) || undefined }));
});
