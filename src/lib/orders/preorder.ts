import { and, eq, inArray, sql } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import type { DbLike } from '@/lib/referrals';
import { listings, orderItems, orders } from '@/lib/db/schema';
import { istAtHour, istDateString, istParts, istStartOfDay, DAY_MS } from '@/lib/time';
import { ACTIVE_STATES, SOLD_STATES, type OrderStatus } from './state';
import type { MealSlot } from '@/lib/slots';

const COUNTED: OrderStatus[] = [...ACTIVE_STATES, ...SOLD_STATES];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const SLOT_HOURS: Record<MealSlot, [number, number]> = { breakfast: [6, 11], lunch: [11, 16], dinner: [18, 23] };

/** The meal slot an IST wall-clock hour falls into, or null outside the serving windows. */
export function slotForHour(hour: number): MealSlot | null {
  for (const slot of Object.keys(SLOT_HOURS) as MealSlot[]) if (hour >= SLOT_HOURS[slot][0] && hour < SLOT_HOURS[slot][1]) return slot;
  return null;
}

/** A default delivery time for a slot on a given IST day (what the date/slot picker sends). */
export function slotTime(day: Date, slot: MealSlot): Date {
  return istAtHour(day, slot === 'breakfast' ? 9 : slot === 'lunch' ? 13 : 20);
}

type Dish = Pick<typeof listings.$inferSelect, 'id' | 'title' | 'leadTimeDays' | 'slotsJson' | 'maxPortionsPerSlot' | 'availableQty'>;

export type PreOrderCheck = { slot: MealSlot; dateKey: string };

/**
 * Rules for a scheduled order (pure): the delivery time must be inside a serving slot, on a day every dish is cooked, far enough
 * ahead for the longest dish lead time and no further than `preOrderMaxDays`.
 */
export function checkPreOrderTime(scheduledFor: Date, dishes: Dish[], settings: { preOrderMaxDays: number }, now: Date = new Date()): PreOrderCheck {
  if (Number.isNaN(scheduledFor.getTime())) throw new ApiError(400, 'Choose a valid delivery time');
  const parts = istParts(scheduledFor);
  const slot = slotForHour(parts.hour);
  if (!slot) throw new ApiError(400, 'Choose a time inside a meal slot (breakfast 6–11, lunch 11–16, dinner 18–23)');
  const dayDiff = Math.round((istStartOfDay(scheduledFor).getTime() - istStartOfDay(now).getTime()) / DAY_MS);
  if (scheduledFor.getTime() <= now.getTime() + 30 * 60_000) throw new ApiError(400, 'A scheduled order must be at least 30 minutes from now');
  if (dayDiff > settings.preOrderMaxDays) throw new ApiError(400, `You can schedule at most ${settings.preOrderMaxDays} days ahead`);
  for (const d of dishes) {
    if (dayDiff < d.leadTimeDays) throw new ApiError(400, `"${d.title}" needs ${d.leadTimeDays} day${d.leadTimeDays === 1 ? '' : 's'} notice`);
    const days = d.slotsJson?.days ?? [];
    if (days.length && !days.includes(DAYS[parts.weekday])) throw new ApiError(400, `"${d.title}" is not cooked on ${DAYS[parts.weekday]}days`);
    const slots = d.slotsJson?.slots ?? [];
    if (slots.length && !slots.includes(slot)) throw new ApiError(400, `"${d.title}" is not served at ${slot}`);
  }
  return { slot, dateKey: istDateString(scheduledFor) };
}

/**
 * Capacity for that delivery date and slot, read inside the booking transaction (kitchen row-locked): the kitchen's orders per slot and
 * each dish's portions per slot (its own max, else the portions it lists). Pre-orders do NOT take today's stock.
 */
export async function assertSlotCapacity(
  tx: DbLike,
  sellerId: number,
  scheduledFor: Date,
  slot: MealSlot,
  lines: { listingId: number; qty: number; title: string }[],
  dishes: Dish[],
  maxOrdersPerSlot: number,
): Promise<void> {
  const dayStart = istStartOfDay(scheduledFor);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const rows = await tx
    .select({ id: orders.id, at: orders.scheduledFor })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), eq(orders.type, 'home_delivery'), inArray(orders.status, COUNTED), sql`${orders.scheduledFor} >= ${dayStart} and ${orders.scheduledFor} < ${dayEnd}`));
  const sameSlot = rows.filter((r) => r.at && slotForHour(istParts(r.at).hour) === slot);
  if (maxOrdersPerSlot > 0 && sameSlot.length + 1 > maxOrdersPerSlot) throw new ApiError(409, `This kitchen is fully booked for ${slot} on that day`);
  if (!sameSlot.length) {
    for (const l of lines) {
      const d = dishes.find((x) => x.id === l.listingId)!;
      if (l.qty > (d.maxPortionsPerSlot ?? d.availableQty)) throw new ApiError(409, `Only ${d.maxPortionsPerSlot ?? d.availableQty} of "${d.title}" can be booked for one slot`);
    }
    return;
  }
  const ids = sameSlot.map((r) => r.id);
  const booked = await tx.select({ listingId: orderItems.listingId, qty: sql<number>`sum(${orderItems.qty})::int` }).from(orderItems).where(inArray(orderItems.orderId, ids)).groupBy(orderItems.listingId);
  for (const l of lines) {
    const d = dishes.find((x) => x.id === l.listingId)!;
    const limit = d.maxPortionsPerSlot ?? d.availableQty;
    const already = booked.find((b) => b.listingId === l.listingId)?.qty ?? 0;
    if (already + l.qty > limit) throw new ApiError(409, `"${d.title}" is fully booked for ${slot} on that day`);
  }
}

/** When a scheduled order must be accepted by: `preOrderAcceptLeadHours` before the slot, but never sooner than the normal acceptance window after booking. */
export function preOrderAcceptBy(scheduledFor: Date, now: Date, settings: { sellerAcceptWindowMinutes: number; preOrderAcceptLeadHours: number }): Date {
  const normal = now.getTime() + settings.sellerAcceptWindowMinutes * 60_000;
  const lead = scheduledFor.getTime() - settings.preOrderAcceptLeadHours * 3_600_000;
  return new Date(Math.max(normal, lead));
}
