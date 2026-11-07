import { api, ApiError, ok, readJson } from '@/lib/api';
import { listSessions, requireSession, revokeSession, revokeAllSessions, sessionKey } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** The signed-in devices of the current user, with the current one marked. */
export const GET = api(async () => {
  const session = await requireSession(undefined, { allowMustChange: true, allowMfaPending: true });
  const rows = await listSessions(session.uid);
  return ok({ sessions: rows.map(({ id, ...r }) => ({ ...r, current: id === session.sid })) , currentKey: sessionKey(session.sid) });
});

/** Sign out one device (`{ key }`) or every device (`{ all: true }`). */
export const DELETE = api(async (req) => {
  const session = await requireSession(undefined, { allowMustChange: true, allowMfaPending: true });
  const body = await readJson<{ key?: string; all?: boolean }>(req);
  if (body.all) {
    await revokeAllSessions(session.uid);
    return ok({ ok: true });
  }
  if (!body.key || !(await revokeSession(session.uid, body.key))) throw new ApiError(404, 'Device not found');
  return ok({ ok: true });
});
