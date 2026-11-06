import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { restoreSetting, settingsHistoryList } from '@/lib/settings/history';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession(['admin']);
  const key = req.nextUrl.searchParams.get('key') || undefined;
  return ok({ history: await settingsHistoryList({ key, limit: Number(req.nextUrl.searchParams.get('limit')) || 100 }) });
});

/** Restore the value a setting had before a given change. Needs a reason and a fresh 2FA check. */
export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const parsed = z.object({ historyId: z.number().int(), reason: z.string().trim().min(3).max(300) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Say why you are restoring this');
  return ok(await restoreSetting(parsed.data.historyId, admin.uid, parsed.data.reason));
});
