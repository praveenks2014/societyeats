import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { acceptReconsent, pendingReconsent } from '@/lib/legal/docs';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['buyer', 'seller']);
  return ok({ pending: await pendingReconsent(session.uid, session.role) });
});

/** Records acceptance of the documents the user was asked to re-accept (the current version of each). */
export const POST = api(async (req) => {
  const session = await requireSession(['buyer', 'seller']);
  const parsed = z.object({ slugs: z.array(z.string()).min(1) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose the documents you accept');
  const n = await acceptReconsent(session.uid, session.role, parsed.data.slugs, req.headers.get('x-forwarded-for')?.split(',')[0]?.trim());
  return ok({ accepted: n, pending: await pendingReconsent(session.uid, session.role) });
});
