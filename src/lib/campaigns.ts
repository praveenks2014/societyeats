import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { campaigns, sellerProfiles } from '@/lib/db/schema';
import { kitchenGate } from '@/lib/kitchen/gate';
import { istDateString } from '@/lib/time';

/** Admin-made festival pre-order window with its own landing page and a hand-picked set of kitchens. */
export async function createCampaign(adminId: number, input: { slug: string; title: string; body: string; startsOn: string; endsOn: string; sellerIds: number[] }) {
  if (!(await getPlatformSettings()).campaignsEnabled) throw new ApiError(404, 'Campaigns are switched off');
  if (!/^[a-z0-9-]{3,60}$/.test(input.slug)) throw new ApiError(400, 'The address can use lowercase letters, digits and dashes');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.startsOn) throw new ApiError(400, 'Choose a valid date range');
  if (input.title.trim().length < 3 || input.body.trim().length < 10) throw new ApiError(400, 'Add a title and a few lines of text');
  const db = await getDb();
  const [dupe] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.slug, input.slug));
  if (dupe) throw new ApiError(409, 'That address is taken');
  const [row] = await db.insert(campaigns).values({ slug: input.slug, title: input.title.trim(), body: input.body.trim(), startsOn: input.startsOn, endsOn: input.endsOn, sellerIdsJson: input.sellerIds }).returning();
  await recordAudit({ actorId: adminId, action: 'campaign.create', targetType: 'campaign', targetId: row.id, meta: { slug: input.slug } });
  return row;
}

export async function activeCampaign(slug: string, now: Date = new Date()) {
  if (!(await getPlatformSettings()).campaignsEnabled) return null;
  const db = await getDb();
  const day = istDateString(now);
  const [c] = await db.select().from(campaigns).where(and(eq(campaigns.slug, slug), eq(campaigns.active, true), lte(campaigns.startsOn, day), gte(campaigns.endsOn, day)));
  if (!c) return null;
  const kitchens: { sellerId: number; kitchen: string }[] = [];
  for (const id of c.sellerIdsJson) {
    const [k] = await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, id));
    if (k && (await kitchenGate(id)).ok) kitchens.push({ sellerId: id, kitchen: k.name });
  }
  return { campaign: c, kitchens };
}

export async function listCampaigns() {
  const db = await getDb();
  return db.select().from(campaigns).orderBy(desc(campaigns.id));
}
