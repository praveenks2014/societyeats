import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { orders, sellerProfiles, users } from '@/lib/db/schema';
import { decryptPan, maskPan } from '@/lib/pan';
import { SOLD_STATES } from '@/lib/orders/state';
import { fyLabel, fyStart } from '@/lib/orders/caps';
import { DAY_MS, istParts } from '@/lib/time';

/** IST instant of 1 April of the FY that STARTS in calendar `year`. */
export function fyStartOfYear(year: number): Date {
  return new Date(Date.UTC(year, 3, 1) - 330 * 60 * 1000);
}
export function fyEndExclusive(startYear: number): Date {
  return fyStartOfYear(startYear + 1);
}
export function fyStartYear(now: Date = new Date()): number {
  return istParts(fyStart(now)).year;
}

function monthKey(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export type Earnings = {
  fy: { label: string; startYear: number };
  months: { month: string; foodPaise: number; orders: number }[];
  totals: { foodPaise: number; orders: number };
  cancellations: { seller_declined: number; seller_cancelled: number; kitchen_missed: number; buyer: number; buyer_unpaid_or_no_show: number };
  acceptance: { windowDays: number; rate: number | null; accepted: number; declined: number; missed: number };
  tds: { fySalesPaise: number; warnPaise: number; pausePaise: number; level: 'ok' | 'warn' | 'paused' };
  ratings: { rating: number; count: number };
};

/** A kitchen's own sales record for a financial year. Food money is paid to the kitchen directly, so this is its books, not a settlement. */
export async function sellerEarnings(sellerId: number, startYear: number = fyStartYear(), now: Date = new Date()): Promise<Earnings> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const from = fyStartOfYear(startYear);
  const to = fyEndExclusive(startYear);

  const sold = await db
    .select({ completedAt: orders.completedAt, food: orders.foodTotalInPaise })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, SOLD_STATES), gte(orders.completedAt, from), lt(orders.completedAt, to)));
  const byMonth = new Map<string, { foodPaise: number; orders: number }>();
  for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(startYear, 3 + m, 1));
    byMonth.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, { foodPaise: 0, orders: 0 });
  }
  for (const o of sold) {
    const k = monthKey(o.completedAt!);
    const e = byMonth.get(k);
    if (e) {
      e.foodPaise += o.food;
      e.orders += 1;
    }
  }
  const months = [...byMonth.entries()].map(([month, v]) => ({ month, ...v }));
  const foodPaise = sold.reduce((s, o) => s + o.food, 0);

  const cancelled = await db
    .select({ status: orders.status, acceptedAt: orders.acceptedAt })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), gte(orders.cancelledAt, from), lt(orders.cancelledAt, to)));
  const c = { seller_declined: 0, seller_cancelled: 0, kitchen_missed: 0, buyer: 0, buyer_unpaid_or_no_show: 0 };
  for (const o of cancelled) {
    if (o.status === 'cancelled_by_seller' || o.status === 'cancelled') o.acceptedAt ? c.seller_cancelled++ : c.seller_declined++;
    else if (o.status === 'cancelled_auto') c.kitchen_missed++;
    else if (o.status === 'cancelled_by_buyer') c.buyer++;
    else if (o.status === 'cancelled_buyer_unpaid' || o.status === 'no_show_buyer') c.buyer_unpaid_or_no_show++;
  }

  // Acceptance rate over the last 30 days: orders the kitchen accepted vs declined or missed (buyer-side cancels are not its doing).
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const recent = await db
    .select({ status: orders.status, acceptedAt: orders.acceptedAt })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), gte(orders.bookedAt, since)));
  let accepted = 0;
  let declined = 0;
  let missed = 0;
  for (const o of recent) {
    if (o.acceptedAt) accepted++;
    else if (o.status === 'cancelled_by_seller' || o.status === 'cancelled') declined++;
    else if (o.status === 'cancelled_auto') missed++;
  }
  const denom = accepted + declined + missed;

  const fySales = await fySalesFor(sellerId, now);
  const [prof] = await db.select({ rating: sellerProfiles.rating, count: sellerProfiles.ratingCount }).from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  const level = settings.tdsPausePaise > 0 && fySales >= settings.tdsPausePaise ? 'paused' : settings.tdsWarnPaise > 0 && fySales >= settings.tdsWarnPaise ? 'warn' : 'ok';
  return {
    fy: { label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`, startYear },
    months,
    totals: { foodPaise, orders: sold.length },
    cancellations: c,
    acceptance: { windowDays: 30, rate: denom ? Math.round((accepted / denom) * 1000) / 10 : null, accepted, declined, missed },
    tds: { fySalesPaise: fySales, warnPaise: settings.tdsWarnPaise, pausePaise: settings.tdsPausePaise, level },
    ratings: { rating: prof?.rating ?? 0, count: prof?.count ?? 0 },
  };
}

async function fySalesFor(sellerId: number, now: Date): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.foodTotalInPaise}), 0)::int` })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, SOLD_STATES), gte(orders.completedAt, fyStart(now))));
  return Number(row?.total ?? 0);
}

export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export async function earningsCsv(sellerId: number, startYear: number): Promise<string> {
  const e = await sellerEarnings(sellerId, startYear);
  const db = await getDb();
  const sold = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, SOLD_STATES), gte(orders.completedAt, fyStartOfYear(startYear)), lt(orders.completedAt, fyEndExclusive(startYear))))
    .orderBy(desc(orders.completedAt));
  return toCsv([
    ['Order', 'Completed (IST date)', 'Food amount (INR)', 'Paid by', 'Payment reference (UTR)'],
    ...sold.map((o) => {
      const p = istParts(o.completedAt!);
      return [o.id, `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, (o.foodTotalInPaise / 100).toFixed(2), o.foodPaymentMethod ?? '', o.foodPaymentUtr ?? ''];
    }),
    [],
    ['Month', 'Orders', 'Food sales (INR)'],
    ...e.months.map((m) => [m.month, m.orders, (m.foodPaise / 100).toFixed(2)]),
  ]);
}

/** Admin: every kitchen's FY gross food sales for the TDS (Sec 393) report. Full PAN only when `fullPan` (after re-auth, logged by the caller). */
export async function tdsReport(startYear: number, fullPan: boolean) {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const rows = await db
    .select({ sellerId: orders.sellerId, food: sql<number>`sum(${orders.foodTotalInPaise})::int`, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(inArray(orders.status, SOLD_STATES), gte(orders.completedAt, fyStartOfYear(startYear)), lt(orders.completedAt, fyEndExclusive(startYear))))
    .groupBy(orders.sellerId);
  const out: (string | number | null)[][] = [['Seller id', 'Kitchen', 'Legal name', 'PAN', 'FY', 'Gross food sales (INR)', 'Orders', 'Warn threshold crossed', 'Pause threshold crossed']];
  const label = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  for (const r of rows.sort((a, b) => b.food - a.food)) {
    const [p] = await db.select({ kitchen: sellerProfiles.kitchenName, panEnc: sellerProfiles.panEnc, legal: sellerProfiles.legalName }).from(sellerProfiles).where(eq(sellerProfiles.userId, r.sellerId!));
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, r.sellerId!));
    let pan = '';
    if (p?.panEnc) {
      try {
        const plain = decryptPan(p.panEnc);
        pan = fullPan ? plain : maskPan(plain);
      } catch {
        pan = 'unreadable';
      }
    }
    out.push([r.sellerId, p?.kitchen ?? '', p?.legal ?? u?.name ?? '', pan, label, (r.food / 100).toFixed(2), r.n, r.food >= settings.tdsWarnPaise ? 'yes' : 'no', r.food >= settings.tdsPausePaise ? 'yes' : 'no']);
  }
  return toCsv(out);
}
