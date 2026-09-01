import { and, countDistinct, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orders } from '@/lib/db/schema';

/**
 * Pilot Hardening v2 — Phase 5 (Trust & hygiene, DECISIONS.md #73+).
 * "Ordered by N neighbours" — the distinct-buyer count of a home kitchen's
 * completed orders, shown as a listing-card/kitchen trust signal alongside
 * FSSAI status and rating. Deliberately distinct buyers, not order count —
 * one regular buying every day shouldn't read as "12 neighbours".
 */
export async function neighbourOrderCount(sellerId: number): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: countDistinct(orders.buyerId) })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, ['delivered', 'picked_up'])));
  return row?.count ?? 0;
}
