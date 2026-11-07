import { and, eq, gte, lte } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { featuredPlacements, sellerProfiles, societies } from '@/lib/db/schema';
import { kitchenGate } from '@/lib/kitchen/gate';
import { istDateString } from '@/lib/time';

/** Admin-assigned Sponsored slot for a kitchen in one society, between two IST dates. Off unless `featuredEnabled`. */
export async function addPlacement(adminId: number, input: { sellerId: number; societyId: number; startsOn: string; endsOn: string }) {
  if (!(await getPlatformSettings()).featuredEnabled) throw new ApiError(404, 'Featured placement is switched off');
  const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(input.startsOn) || !ok(input.endsOn) || input.endsOn < input.startsOn) throw new ApiError(400, 'Choose a valid date range');
  const db = await getDb();
  const [k] = await db.select({ id: sellerProfiles.userId }).from(sellerProfiles).where(eq(sellerProfiles.userId, input.sellerId));
  const [soc] = await db.select({ id: societies.id }).from(societies).where(eq(societies.id, input.societyId));
  if (!k || !soc) throw new ApiError(404, 'Kitchen or society not found');
  const [row] = await db.insert(featuredPlacements).values({ ...input, createdBy: adminId }).returning();
  await recordAudit({ actorId: adminId, action: 'featured.add', targetType: 'kitchen', targetId: input.sellerId, meta: input });
  return row;
}

export async function endPlacement(adminId: number, id: number) {
  const db = await getDb();
  const [row] = await db.update(featuredPlacements).set({ endsOn: istDateString(new Date(Date.now() - 86_400_000)) }).where(eq(featuredPlacements.id, id)).returning();
  if (!row) throw new ApiError(404, 'Placement not found');
  await recordAudit({ actorId: adminId, action: 'featured.end', targetType: 'kitchen', targetId: row.sellerId });
  return row;
}

/** Kitchens sponsored for this society today that are actually orderable. Always shown separately and labelled “Sponsored”, never mixed into ranking. */
export async function sponsoredFor(societyId: number | null | undefined, now: Date = new Date()) {
  if (!societyId || !(await getPlatformSettings()).featuredEnabled) return [];
  const db = await getDb();
  const day = istDateString(now);
  const rows = await db
    .select({ p: featuredPlacements, name: sellerProfiles.kitchenName })
    .from(featuredPlacements)
    .innerJoin(sellerProfiles, eq(sellerProfiles.userId, featuredPlacements.sellerId))
    .where(and(eq(featuredPlacements.societyId, societyId), lte(featuredPlacements.startsOn, day), gte(featuredPlacements.endsOn, day)));
  const out: { sellerId: number; kitchen: string; sponsored: true }[] = [];
  for (const r of rows) if ((await kitchenGate(r.p.sellerId)).ok) out.push({ sellerId: r.p.sellerId, kitchen: r.name, sponsored: true });
  return out;
}
