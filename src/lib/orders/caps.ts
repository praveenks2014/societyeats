import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '@/lib/referrals';
import { orders } from '@/lib/db/schema';
import { istParts, istStartOfDay } from '@/lib/time';
import { ACTIVE_STATES, SOLD_STATES, type OrderStatus } from './state';
import type { CapUsage } from '@/lib/fssai/tier';

/** Statuses that occupy a kitchen's capacity: open orders (incl. an unpaid fee hold) and completed sales. */
const COUNTED: OrderStatus[] = [...ACTIVE_STATES, ...SOLD_STATES];

/** Orders today (IST), food value today and food value in total for one kitchen — read inside the booking transaction under a row lock. */
export async function sellerCapUsage(tx: DbLike, sellerId: number, now: Date = new Date()): Promise<CapUsage & { ordersTodayAll: number }> {
  const todayStart = istStartOfDay(now);
  const rows = await tx
    .select({ createdAt: orders.createdAt, food: orders.foodTotalInPaise })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), eq(orders.type, 'home_delivery'), inArray(orders.status, COUNTED)));
  let ordersToday = 0;
  let foodToday = 0;
  let foodTotal = 0;
  for (const r of rows) {
    foodTotal += r.food;
    if (r.createdAt.getTime() >= todayStart.getTime()) {
      ordersToday++;
      foodToday += r.food;
    }
  }
  return { ordersToday, foodTodayPaise: foodToday, foodTotalPaise: foodTotal, ordersTodayAll: ordersToday };
}

/** Start of the Indian financial year (1 April, IST) containing `now`. */
export function fyStart(now: Date = new Date()): Date {
  const p = istParts(now);
  const year = p.month >= 4 ? p.year : p.year - 1;
  return new Date(Date.UTC(year, 3, 1) - 330 * 60 * 1000);
}

export function fyLabel(now: Date = new Date()): string {
  const start = istParts(fyStart(now));
  return `${start.year}-${String((start.year + 1) % 100).padStart(2, '0')}`;
}

/** Gross food sales (completed orders) for a kitchen this financial year, in paise. Basis of the Sec 393 TDS tracking. */
export async function sellerFySalesPaise(tx: DbLike, sellerId: number, now: Date = new Date()): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${orders.foodTotalInPaise}), 0)::int` })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, SOLD_STATES), gte(orders.completedAt, fyStart(now))));
  return Number(row?.total ?? 0);
}
