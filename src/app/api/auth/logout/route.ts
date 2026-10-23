import { api, ok } from '@/lib/api';
import { destroyCurrentSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const POST = api(async () => {
  await destroyCurrentSession();
  return ok({ ok: true });
});
