import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export function newInviteCode(name: string): string {
  const base = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'PADOSI';
  return `${base}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

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

export const societyInput = z.object({
  name: z.string().trim().min(2, 'Name is required').max(160),
  city: z.string().trim().min(2, 'City is required').max(80),
  addressText: z.string().trim().min(3, 'Address is required').max(500),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional().or(z.literal('')),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isLive: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  targetHouseholds: z.number().int().min(1).max(100000).optional(),
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
