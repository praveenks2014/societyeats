import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getPrefs, setPrefs } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['buyer', 'seller']);
  return ok({ prefs: await getPrefs(session.uid) });
});

/** Order and account messages by in-app and email are always on; these switches cover push, WhatsApp, SMS and offers. */
export const PATCH = api(async (req) => {
  const session = await requireSession(['buyer', 'seller']);
  const parsed = z.object({ pushEnabled: z.boolean().optional(), whatsappEnabled: z.boolean().optional(), smsEnabled: z.boolean().optional(), marketingEnabled: z.boolean().optional() }).strict().safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  return ok({ prefs: await setPrefs(session.uid, parsed.data) });
});
