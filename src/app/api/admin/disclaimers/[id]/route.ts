import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { DISCLAIMER_IDS, type DisclaimerId } from '@/lib/disclaimers/defs';
import { disclaimerHistory, updateDisclaimer } from '@/lib/disclaimers';

export const dynamic = 'force-dynamic';

function idOf(raw: string): DisclaimerId {
  if (!(DISCLAIMER_IDS as string[]).includes(raw)) throw new ApiError(404, 'Unknown disclaimer');
  return raw as DisclaimerId;
}

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  return ok({ history: await disclaimerHistory(idOf(params.id)) });
});

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const id = idOf(params.id);
  const parsed = z.object({ text: z.string().min(10).max(1200) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Disclaimer text must be 10–1200 characters');
  const version = await updateDisclaimer(id, parsed.data.text, admin.uid);
  await recordAudit({ actorId: admin.uid, action: 'disclaimer.update', targetType: 'disclaimer', targetId: id, meta: { version } });
  return ok({ version });
});
