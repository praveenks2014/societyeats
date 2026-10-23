import { api, ok } from '@/lib/api';
import { destroyCurrentSession, requireSession, revokeAllSessions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** "Log out of all devices". */
export const POST = api(async () => {
  const session = await requireSession(undefined, { allowMustChange: true });
  await revokeAllSessions(session.uid);
  await destroyCurrentSession();
  return ok({ ok: true });
});
