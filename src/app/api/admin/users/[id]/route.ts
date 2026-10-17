import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession, revokeAllSessions } from '@/lib/auth';
import { sendPasswordResetEmail } from '@/lib/auth/mail';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { orders, sellerProfiles, societies, users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  const id = Number(params.id);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new ApiError(404, 'User not found');
  const [soc] = u.societyId ? await db.select().from(societies).where(eq(societies.id, u.societyId)) : [];
  const [kitchen] = await db.select({ name: sellerProfiles.kitchenName, state: sellerProfiles.listingState }).from(sellerProfiles).where(eq(sellerProfiles.userId, id));
  const [stats] = await db.select({ n: sql<number>`count(*)` }).from(orders).where(eq(orders.buyerId, id));
  const { passwordHash, ...safe } = u;
  void passwordHash;
  return ok({ user: safe, society: soc ?? null, kitchen: kitchen ?? null, orderCount: Number(stats?.n ?? 0) });
});

const schema = z.object({ action: z.enum(['block', 'unblock', 'reset_password']), reason: z.string().trim().max(500).optional() });

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  const id = Number(params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid action');
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new ApiError(404, 'User not found');
  if (id === admin.uid) throw new ApiError(400, "You can't do that to your own account");
  switch (parsed.data.action) {
    case 'block':
      await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, id));
      await revokeAllSessions(id); // blocking kills sessions
      break;
    case 'unblock':
      await db.update(users).set({ blockedAt: null }).where(eq(users.id, id));
      break;
    case 'reset_password':
      if (!u.email) throw new ApiError(400, 'This user has no email on file');
      await sendPasswordResetEmail(id);
      break;
  }
  await recordAudit({ actorId: admin.uid, action: `user.${parsed.data.action}`, targetType: 'user', targetId: id, meta: { reason: parsed.data.reason } });
  return ok({ ok: true });
});
