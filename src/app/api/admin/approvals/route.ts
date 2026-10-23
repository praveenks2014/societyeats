import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notifyUser } from '@/lib/db/notify';
import { societies, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Residents waiting for approval (societies with requireApproval). */
export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, phone: users.phone, email: users.email, role: users.role, createdAt: users.createdAt, society: societies.name })
    .from(users)
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(eq(users.approvalStatus, 'pending'))
    .orderBy(users.createdAt);
  return ok({ pending: rows });
});

const schema = z.object({ userId: z.number().int(), decision: z.enum(['approve', 'reject']) });

export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const { userId, decision } = parsed.data;
  const db = await getDb();
  const [u] = await db
    .update(users)
    .set({ approvalStatus: decision === 'approve' ? 'approved' : 'rejected' })
    .where(and(eq(users.id, userId), eq(users.approvalStatus, 'pending')))
    .returning();
  if (!u) throw new ApiError(404, 'No pending resident with that id');
  await recordAudit({ actorId: admin.uid, action: `resident.${decision}`, targetType: 'user', targetId: userId });
  await notifyUser(
    userId,
    decision === 'approve' ? 'Welcome — you are approved ✅' : 'Your sign-up was not approved',
    decision === 'approve' ? 'You can now order from your neighbours.' : 'Contact support if you think this is a mistake.',
    '/',
    { email: true, emailKind: `resident_${decision}` },
  );
  return ok({ ok: true });
});
