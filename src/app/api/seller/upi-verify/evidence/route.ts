import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { attachEvidence } from '@/lib/upi-verify';

export const dynamic = 'force-dynamic';

const schema = z.object({ verificationId: z.number().int(), fileKey: z.string().min(3).max(120) });

export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  await attachEvidence(session.uid, parsed.data.verificationId, parsed.data.fileKey);
  return ok({ ok: true });
});
