import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth';
import { adminResolveVerification } from '@/lib/upi-verify';

export const dynamic = 'force-dynamic';

const schema = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() });

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const id = Number(params.id);
  await adminResolveVerification(id, admin.uid, parsed.data.decision, parsed.data.note);
  await recordAudit({ actorId: admin.uid, action: `upi_verification.${parsed.data.decision}`, targetType: 'upi_verification', targetId: id, meta: { note: parsed.data.note } });
  return ok({ ok: true });
});
