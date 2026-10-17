import { sql } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';
import { newInviteCode, societyInput } from '@/lib/societies';

export const dynamic = 'force-dynamic';

/** Societies with resident / kitchen counts. */
export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db.select().from(societies).orderBy(societies.id);
  const counts = await db.execute(sql`
    select u.society_id as society_id,
           count(*) filter (where u.role = 'buyer') as residents,
           count(*) filter (where u.role = 'seller') as kitchens,
           count(*) filter (where u.approval_status = 'pending') as pending
    from users u where u.society_id is not null group by u.society_id`);
  const arr = (Array.isArray(counts) ? counts : (counts as { rows: unknown[] }).rows) as { society_id: number; residents: string; kitchens: string; pending: string }[];
  return ok({
    societies: rows.map((s) => {
      const c = arr.find((x) => x.society_id === s.id);
      return { ...s, residents: Number(c?.residents ?? 0), kitchens: Number(c?.kitchens ?? 0), pending: Number(c?.pending ?? 0) };
    }),
  });
});

export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  const parsed = societyInput.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const v = parsed.data;
  const db = await getDb();
  const [s] = await db
    .insert(societies)
    .values({ ...v, pincode: v.pincode || null, inviteCode: newInviteCode(v.name), isLive: v.isLive ?? false })
    .returning();
  await recordAudit({ actorId: admin.uid, action: 'society.create', targetType: 'society', targetId: s.id });
  return ok({ society: s }, 201);
});
