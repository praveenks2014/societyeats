import { and, desc, eq, inArray } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { listings, orderItems, orders, sellerProfiles } from '@/lib/db/schema';
import { kitchenGate } from '@/lib/kitchen/gate';
import { COMPLETED_STATES } from '@/lib/orders/state';

export type CartPayload = {
  vendor: { kind: 'seller'; id: number; name: string };
  items: { id: number; title: string; pricePaise: number; isVeg: boolean; photoUrl: string | null; maxQty: number; qty: number }[];
  skipped: string[];
};

const orderable = (l: typeof listings.$inferSelect) => l.isActive && l.moderationStatus === 'approved' && l.availableQty > 0;

/**
 * Repeat a past order: the same dishes and quantities at TODAY's prices and availability. Dishes that are gone, paused or sold out are
 * skipped (and named), quantity is capped at what is left, and a kitchen that cannot take orders now yields nothing to add.
 */
export async function repeatCart(orderId: number, buyerId: number): Promise<CartPayload> {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)));
  if (!o || !o.sellerId) throw new ApiError(404, 'Order not found');
  if (o.type !== 'home_delivery') throw new ApiError(400, 'Only home-kitchen orders can be repeated');
  const [kitchen] = await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, o.sellerId));
  const gate = await kitchenGate(o.sellerId);
  if (!gate.ok) throw new ApiError(409, 'This kitchen is not taking orders right now');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const ids = items.map((i) => i.listingId).filter((x): x is number => x != null);
  const dishes = ids.length ? await db.select().from(listings).where(inArray(listings.id, ids)) : [];
  const out: CartPayload = { vendor: { kind: 'seller', id: o.sellerId, name: kitchen?.name ?? 'Kitchen' }, items: [], skipped: [] };
  for (const it of items) {
    const d = dishes.find((x) => x.id === it.listingId);
    if (!d || !orderable(d)) {
      out.skipped.push(it.titleSnapshot);
      continue;
    }
    out.items.push({ id: d.id, title: d.title, pricePaise: d.priceInPaise, isVeg: d.isVeg, photoUrl: d.photoUrl, maxQty: d.availableQty, qty: Math.min(it.qty, d.availableQty) });
  }
  if (!out.items.length) throw new ApiError(409, 'None of the dishes in that order are available today');
  return out;
}

/** “Your usuals”: the dishes a buyer has had delivered most often, still orderable, most-ordered first. */
export async function usualsFor(buyerId: number, limit = 6) {
  const db = await getDb();
  const rows = await db
    .select({ listingId: orderItems.listingId, qty: orderItems.qty, sellerId: orders.sellerId, at: orders.completedAt })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.buyerId, buyerId), eq(orders.type, 'home_delivery'), inArray(orders.status, COMPLETED_STATES)))
    .orderBy(desc(orders.completedAt));
  const tally = new Map<number, { times: number; sellerId: number; last: number }>();
  for (const r of rows) {
    if (r.listingId == null || r.sellerId == null) continue;
    const t = tally.get(r.listingId) ?? { times: 0, sellerId: r.sellerId, last: r.at?.getTime() ?? 0 };
    t.times += 1;
    tally.set(r.listingId, t);
  }
  if (!tally.size) return [];
  const dishes = await db.select().from(listings).where(inArray(listings.id, [...tally.keys()]));
  const kitchens = await db.select({ id: sellerProfiles.userId, name: sellerProfiles.kitchenName }).from(sellerProfiles).where(inArray(sellerProfiles.userId, [...new Set([...tally.values()].map((t) => t.sellerId))]));
  const out: { id: number; title: string; pricePaise: number; isVeg: boolean; photoUrl: string | null; maxQty: number; sellerId: number; kitchen: string; times: number }[] = [];
  for (const d of dishes) {
    if (!orderable(d)) continue;
    const t = tally.get(d.id)!;
    if (!(await kitchenGate(d.sellerId)).ok) continue;
    out.push({ id: d.id, title: d.title, pricePaise: d.priceInPaise, isVeg: d.isVeg, photoUrl: d.photoUrl, maxQty: d.availableQty, sellerId: d.sellerId, kitchen: kitchens.find((k) => k.id === t.sellerId)?.name ?? 'Kitchen', times: t.times });
  }
  return out.sort((a, b) => b.times - a.times).slice(0, limit);
}
