import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { broadcastHistory, previewBroadcast, sendBroadcast } from '@/lib/broadcast';

export const dynamic = 'force-dynamic';

const audience = z.discriminatedUnion('type', [z.object({ type: z.literal('all') }), z.object({ type: z.literal('kitchens') }), z.object({ type: z.literal('societies'), societyIds: z.array(z.number().int()).min(1).max(50) })]);
const kind = z.enum(['service', 'marketing']);

/** History, plus a recipient count for an audience (?type=…&kind=…&societyIds=1,2) — the preview an admin confirms before sending. */
export const GET = api(async (req) => {
  await requireSession(['admin']);
  const sp = req.nextUrl.searchParams;
  if (sp.get('type')) {
    const a = audience.safeParse({ type: sp.get('type'), societyIds: (sp.get('societyIds') ?? '').split(',').filter(Boolean).map(Number) });
    const k = kind.safeParse(sp.get('kind') ?? 'service');
    if (!a.success || !k.success) throw new ApiError(400, 'Choose an audience');
    return ok(await previewBroadcast(a.data, k.data));
  }
  return ok({ history: await broadcastHistory() });
});

/** Send. Needs a fresh 2FA check and the recipient count the admin saw on the preview. */
export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const parsed = z.object({ audience, kind, title: z.string(), body: z.string(), expectedRecipients: z.number().int() }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Fill in the audience, title and message');
  return ok(await sendBroadcast({ ...parsed.data, adminId: admin.uid }));
});
