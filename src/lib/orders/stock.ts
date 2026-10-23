import { and, eq, gte, sql } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import type { DbLike } from '@/lib/referrals';
import { listings, orderItems, orders } from '@/lib/db/schema';

/**
 * Stock is reserved when the order is created (inside the same transaction as
 * the order insert) with an `available_qty >= qty` guard, so two buyers can
 * never both take the last portion. It is released exactly once — on expiry,
 * payment failure, rejection or cancellation — guarded by orders.stock_reserved.
 */
export async function reserveStock(tx: DbLike, items: { listingId: number; qty: number; title: string }[]): Promise<void> {
  for (const it of items) {
    const [row] = await tx
      .update(listings)
      .set({ availableQty: sql`${listings.availableQty} - ${it.qty}` })
      .where(and(eq(listings.id, it.listingId), gte(listings.availableQty, it.qty)))
      .returning({ left: listings.availableQty });
    if (!row) {
      const [cur] = await tx.select({ q: listings.availableQty }).from(listings).where(eq(listings.id, it.listingId));
      throw new ApiError(409, cur && cur.q > 0 ? `Only ${cur.q} of "${it.title}" left` : `"${it.title}" just sold out`);
    }
  }
}

/** Returns reserved stock to the shelf, once. Returns true if this call released it. */
export async function releaseStock(tx: DbLike, orderId: number): Promise<boolean> {
  const [flag] = await tx
    .update(orders)
    .set({ stockReserved: false })
    .where(and(eq(orders.id, orderId), eq(orders.stockReserved, true)))
    .returning({ id: orders.id });
  if (!flag) return false;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const it of items) {
    if (it.listingId) {
      await tx.update(listings).set({ availableQty: sql`${listings.availableQty} + ${it.qty}` }).where(eq(listings.id, it.listingId));
    }
  }
  return true;
}
