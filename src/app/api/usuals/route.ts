import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { usualsFor } from '@/lib/repeat';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['buyer', 'seller']);
  return ok({ usuals: await usualsFor(session.uid) });
});
