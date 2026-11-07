import { and, eq, inArray } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { bulkRequests, listings, sellerProfiles } from '@/lib/db/schema';
import { createHomeOrder } from '@/lib/orders/create';
import { notify } from '@/lib/db/notify';
import { istDateString } from '@/lib/time';

async function assertOn() {
  if (!(await getPlatformSettings()).bulkOrdersEnabled) throw new ApiError(404, 'Bulk orders are not available');
}

/** A buyer asks one kitchen for a party-size order. The kitchen answers with a quote; the platform fee is charged only if the buyer accepts. */
export async function requestBulk(buyerId: number, input: { sellerId: number; description: string; portions: number; forDate: string }) {
  await assertOn();
  const s = await getPlatformSettings();
  if (!Number.isInteger(input.portions) || input.portions < s.bulkMinPortions) throw new ApiError(400, `Bulk orders start at ${s.bulkMinPortions} portions`);
  if (input.description.trim().length < 10) throw new ApiError(400, 'Describe what you need (at least a sentence)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.forDate) || input.forDate <= istDateString()) throw new ApiError(400, 'Choose a date after today');
  const db = await getDb();
  const [k] = await db.select({ id: sellerProfiles.userId }).from(sellerProfiles).where(eq(sellerProfiles.userId, input.sellerId));
  if (!k) throw new ApiError(404, 'Kitchen not found');
  const [row] = await db.insert(bulkRequests).values({ buyerId, sellerId: input.sellerId, description: input.description.trim().slice(0, 1000), portions: input.portions, forDate: input.forDate }).returning();
  await notify(input.sellerId, 'A neighbour asked for a bulk order', `${input.portions} portions for ${input.forDate}. Send a quote.`, '/seller/bulk');
  return row;
}

/** The kitchen quotes by choosing dishes and quantities at its normal prices (so stock, caps and the fee work exactly as for any order). */
export async function quoteBulk(sellerId: number, id: number, items: { listingId: number; qty: number }[], note?: string) {
  await assertOn();
  const db = await getDb();
  const [r] = await db.select().from(bulkRequests).where(and(eq(bulkRequests.id, id), eq(bulkRequests.sellerId, sellerId)));
  if (!r) throw new ApiError(404, 'Request not found');
  if (!['requested', 'quoted'].includes(r.status)) throw new ApiError(409, 'This request is closed');
  const total = items.reduce((a, i) => a + i.qty, 0);
  if (items.some((i) => !Number.isInteger(i.qty) || i.qty < 1) || total < (await getPlatformSettings()).bulkMinPortions) throw new ApiError(400, 'The quote must cover the minimum number of portions');
  const dishes = await db.select().from(listings).where(and(inArray(listings.id, items.map((i) => i.listingId)), eq(listings.sellerId, sellerId)));
  if (dishes.length !== new Set(items.map((i) => i.listingId)).size) throw new ApiError(400, 'Quote only your own dishes');
  await db.update(bulkRequests).set({ status: 'quoted', quoteItemsJson: items, quoteNote: note?.slice(0, 500) ?? null, quotedAt: new Date() }).where(eq(bulkRequests.id, id));
  await notify(r.buyerId, 'Your bulk order has a quote', note?.slice(0, 100) ?? 'Open it to accept.', '/bulk');
  return { ok: true };
}

/** Accepting turns the quote into a scheduled order (noon on the date). The buyer then pays the platform fee; food is paid at the door as always. */
export async function acceptBulk(buyerId: number, id: number) {
  await assertOn();
  const db = await getDb();
  const [r] = await db.select().from(bulkRequests).where(and(eq(bulkRequests.id, id), eq(bulkRequests.buyerId, buyerId)));
  if (!r) throw new ApiError(404, 'Request not found');
  if (r.status !== 'quoted' || !r.quoteItemsJson) throw new ApiError(409, 'There is no quote to accept');
  const when = new Date(`${r.forDate}T13:00:00+05:30`);
  const order = await createHomeOrder({ buyerId, sellerId: r.sellerId, items: r.quoteItemsJson.map((i) => ({ id: i.listingId, qty: i.qty })), fulfillmentType: 'self_pickup', scheduledFor: when, buyerNote: `Bulk order: ${r.description}`.slice(0, 300) });
  await db.update(bulkRequests).set({ status: 'accepted', orderId: order.orderId }).where(eq(bulkRequests.id, id));
  return order;
}

export async function declineBulk(userId: number, id: number) {
  const db = await getDb();
  const [r] = await db.select().from(bulkRequests).where(eq(bulkRequests.id, id));
  if (!r || (r.sellerId !== userId && r.buyerId !== userId)) throw new ApiError(404, 'Request not found');
  if (!['requested', 'quoted'].includes(r.status)) throw new ApiError(409, 'This request is closed');
  await db.update(bulkRequests).set({ status: r.sellerId === userId ? 'declined' : 'cancelled' }).where(eq(bulkRequests.id, id));
}
