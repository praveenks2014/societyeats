import { and, eq, gte, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orders } from '@/lib/db/schema';

/**
 * Seller order-cap by meal slot (DECISIONS.md #37+): `seller_profiles.maxOrdersPerSlot`
 * caps how many orders a home kitchen takes per breakfast/lunch/dinner window,
 * independent of per-dish `availableQty` — a cook can have plenty of portions
 * left across several dishes but still not want more than N orders in flight
 * at once. No cron/workers (matches the rest of this app): computed lazily
 * from `orders.createdAt` whenever a listing is viewed or an order is placed.
 */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

const SLOT_WINDOWS: Record<MealSlot, [number, number]> = {
  breakfast: [6, 11],
  lunch: [11, 16],
  dinner: [18, 23],
};

/** Which meal slot "now" falls into, by hour-of-day; null outside every serving window. */
export function currentSlot(now: Date = new Date()): MealSlot | null {
  const hour = now.getHours();
  for (const slot of Object.keys(SLOT_WINDOWS) as MealSlot[]) {
    const [start, end] = SLOT_WINDOWS[slot];
    if (hour >= start && hour < end) return slot;
  }
  return null;
}

function slotStartToday(slot: MealSlot, now: Date): Date {
  const d = new Date(now);
  d.setHours(SLOT_WINDOWS[slot][0], 0, 0, 0);
  return d;
}

/**
 * Orders counted against `maxOrdersPerSlot`: this seller's orders created
 * within the given slot's window today, excluding ones that freed up
 * capacity (cancelled / declined-and-refunded).
 */
export async function slotOrderCount(
  sellerId: number,
  slot: MealSlot,
  now: Date = new Date(),
): Promise<number> {
  const db = await getDb();
  const since = slotStartToday(slot, now);
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.sellerId, sellerId),
        gte(orders.createdAt, since),
        ne(orders.status, 'cancelled'),
        ne(orders.status, 'refund_pending'),
      ),
    );
  return rows.length;
}

/**
 * True when the seller has hit `maxOrdersPerSlot` for the slot "now" falls
 * in, AND that slot is one this listing is actually served in. Outside every
 * serving window (e.g. late night), nothing is blocked on this basis — the
 * cap is a per-meal-service throttle, not a store-hours gate.
 */
export async function isSlotSoldOut(
  sellerId: number,
  maxOrdersPerSlot: number,
  listingSlots: string[] | null | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  const slot = currentSlot(now);
  if (!slot) return false;
  if (listingSlots && listingSlots.length > 0 && !listingSlots.includes(slot)) return false;
  const count = await slotOrderCount(sellerId, slot, now);
  return count >= maxOrdersPerSlot;
}
