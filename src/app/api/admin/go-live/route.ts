import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { collectGoLive } from '@/lib/go-live';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  return ok(await collectGoLive());
});
