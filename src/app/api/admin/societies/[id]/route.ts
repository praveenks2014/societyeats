import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';
import { newInviteCode, societyInput } from '@/lib/societies';

export const dynamic = 'force-dynamic';

const patch = societyInput.partial().extend({
  isActive: z.boolean().optional(),
  rotateInviteCode: z.boolean().optional(),
});

/** Edit a society, toggle live / require-approval, deactivate, or rotate its invite code. */
export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  const id = Number(params.id);
  const parsed = patch.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const { rotateInviteCode, pincode, ...rest } = parsed.data;
  const db = await getDb();
  const [existing] = await db.select().from(societies).where(eq(societies.id, id));
  if (!existing) throw new ApiError(404, 'Society not found');
  const [s] = await db
    .update(societies)
    .set({ ...rest, ...(pincode !== undefined ? { pincode: pincode || null } : {}), ...(rotateInviteCode ? { inviteCode: newInviteCode(existing.name) } : {}) })
    .where(eq(societies.id, id))
    .returning();
  await recordAudit({ actorId: admin.uid, action: 'society.update', targetType: 'society', targetId: id, meta: { ...rest, rotateInviteCode } });
  return ok({ society: s });
});
