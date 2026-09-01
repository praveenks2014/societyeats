import { and, count, countDistinct, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';

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

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). Total completed orders (delivered + picked_up), used for the seller
 * recognition badges at 10 / 50 / 100 orders — deliberately every order, not
 * distinct buyers (unlike neighbourOrderCount above), since a badge is about
 * cooking volume/reliability, not reach.
 */
export async function sellerCompletedOrderCount(sellerId: number): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: count() })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, ['delivered', 'picked_up'])));
  return row?.count ?? 0;
}

/** Highest badge tier (from DEFAULTS.sellerOrderBadgeTiers) this order count qualifies for, or null. */
export function sellerBadgeTier(completedOrderCount: number): number | null {
  const tiers = [...DEFAULTS.sellerOrderBadgeTiers].sort((a, b) => b - a);
  return tiers.find((t) => completedOrderCount >= t) ?? null;
}
