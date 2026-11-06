import { api, ok, readJson } from '@/lib/api';
import { markSessionMfaVerified, requireSession } from '@/lib/auth';
import { checkSecondFactor } from '../verify/route';

export const dynamic = 'force-dynamic';

/** Confirms the authenticator again right before a sensitive admin action (settings, refunds, delist, chat read, export). */
export const POST = api(async (req) => {
  const session = await requireSession(['admin']);
  const { code } = await readJson<{ code: string }>(req);
  await checkSecondFactor(session.uid, code);
  await markSessionMfaVerified(session.sid);
  return ok({ ok: true });
});
