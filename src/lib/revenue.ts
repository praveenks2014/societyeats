import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { kitchenRefundsDue, kitchenSubscriptions, orders, refunds, sellerProfiles } from '@/lib/db/schema';
import { overallStatus } from '@/lib/subscriptions/status';
import { DAY_MS, istStartOfDay } from '@/lib/time';

export type RevenueRange = 'today' | '7d' | '30d';

export function rangeStart(range: RevenueRange, now: Date): Date {
  if (range === 'today') return istStartOfDay(now);
  return new Date(now.getTime() - (range === '7d' ? 7 : 30) * DAY_MS);
}

/** The platform's own revenue: buyer platform fees + kitchen subscriptions (gross, GST, net), refunds and risk counters. */
export async function revenueReport(range: RevenueRange, now: Date = new Date()) {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const since = rangeStart(range, now);

  const paidOrders = await db
    .select()
    .from(orders)
    .where(and(eq(orders.type, 'home_delivery'), isNotNull(orders.feePaidAt), gte(orders.feePaidAt, since)));
  const fee = {
    orders: paidOrders.length,
    grossPaise: paidOrders.reduce((s, o) => s + o.onlineChargeInPaise, 0),
    gstPaise: paidOrders.reduce((s, o) => s + o.platformFeeGstInPaise, 0),
    ecoGstPaise: paidOrders.reduce((s, o) => s + o.gstInPaise, 0),
    netPaise: paidOrders.reduce((s, o) => s + o.platformFeeInPaise, 0),
  };

  const paidSubs = await db.select().from(kitchenSubscriptions).where(and(isNotNull(kitchenSubscriptions.paidAt), gte(kitchenSubscriptions.paidAt, since)));
  const subscriptions = {
    count: paidSubs.length,
    grossPaise: paidSubs.reduce((s, r) => s + r.pricePaiseSnapshot + r.gstPaise, 0),
    gstPaise: paidSubs.reduce((s, r) => s + r.gstPaise, 0),
    netPaise: paidSubs.reduce((s, r) => s + r.pricePaiseSnapshot, 0),
  };

  const refundRows = await db.select().from(refunds).where(and(gte(refunds.createdAt, since), inArray(refunds.status, ['processed', 'pending'])));
  const refundTotals = {
    count: refundRows.length,
    platformFeePaise: refundRows.filter((r) => r.kind !== 'subscription').reduce((s, r) => s + r.amountInPaise, 0),
    subscriptionPaise: refundRows.filter((r) => r.kind === 'subscription').reduce((s, r) => s + r.amountInPaise, 0),
  };

  const allSubs = await db.select().from(kitchenSubscriptions);
  const sellerIds = (await db.select({ id: sellerProfiles.userId }).from(sellerProfiles)).map((r) => r.id);
  const counts = { active: 0, waived: 0, grace: 0, expired: 0, none: 0 };
  const expiringSoon: { sellerId: number; endsAt: Date }[] = [];
  for (const id of sellerIds) {
    const mine = allSubs.filter((s) => s.sellerId === id);
    const st = overallStatus(mine, now, settings.subscriptionGraceDays);
    counts[st as keyof typeof counts]++;
    const ends = mine.filter((s) => s.endsAt && !['cancelled', 'pending_payment'].includes(s.status)).map((s) => s.endsAt!);
    const latest = ends.sort((a, b) => b.getTime() - a.getTime())[0];
    if (latest && latest > now && latest.getTime() - now.getTime() <= 7 * DAY_MS) expiringSoon.push({ sellerId: id, endsAt: latest });
  }

  const modeRows = await db
    .select({ mode: orders.foodPaymentMode, n: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.type, 'home_delivery'), isNotNull(orders.feePaidAt), gte(orders.feePaidAt, since)))
    .groupBy(orders.foodPaymentMode);
  const [unconfirmed] = await db.select({ n: sql<number>`count(*)` }).from(orders).where(eq(orders.status, 'awaiting_kitchen_payment_confirmation'));
  const [due] = await db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${kitchenRefundsDue.amountInPaise}), 0)` })
    .from(kitchenRefundsDue)
    .where(eq(kitchenRefundsDue.status, 'due'));

  return {
    range,
    since,
    fee,
    subscriptions,
    refunds: refundTotals,
    totalNetRevenuePaise: fee.netPaise + subscriptions.netPaise - refundTotals.subscriptionPaise,
    subscriptionStatus: counts,
    expiringIn7Days: expiringSoon.length,
    expiringKitchens: expiringSoon,
    ordersByFoodPaymentMode: Object.fromEntries(modeRows.map((r) => [r.mode ?? 'unknown', Number(r.n)])),
    unconfirmedKitchenPayments: Number(unconfirmed?.n ?? 0),
    outstandingKitchenRefunds: { count: Number(due?.n ?? 0), totalPaise: Number(due?.total ?? 0) },
  };
}

export function revenueCsv(r: Awaited<ReturnType<typeof revenueReport>>): string {
  const rupees = (p: number) => (p / 100).toFixed(2);
  const rows: (string | number)[][] = [
    ['PadosiPlate revenue report', r.range, `since ${r.since.toISOString()}`],
    [],
    ['Line', 'Count', 'Gross (INR)', 'GST (INR)', 'Net (INR)'],
    ['Buyer platform fee', r.fee.orders, rupees(r.fee.grossPaise), rupees(r.fee.gstPaise + r.fee.ecoGstPaise), rupees(r.fee.netPaise)],
    ['Kitchen subscriptions', r.subscriptions.count, rupees(r.subscriptions.grossPaise), rupees(r.subscriptions.gstPaise), rupees(r.subscriptions.netPaise)],
    ['Refunds — platform fee', r.refunds.count, rupees(r.refunds.platformFeePaise), '', ''],
    ['Refunds — subscriptions', '', rupees(r.refunds.subscriptionPaise), '', ''],
    [],
    ['Active subscriptions', r.subscriptionStatus.active + r.subscriptionStatus.waived],
    ['In grace', r.subscriptionStatus.grace],
    ['Expired', r.subscriptionStatus.expired],
    ['Expiring in 7 days', r.expiringIn7Days],
    ['Unconfirmed kitchen payments', r.unconfirmedKitchenPayments],
    ['Outstanding kitchen refunds (count)', r.outstandingKitchenRefunds.count],
    ['Outstanding kitchen refunds (INR)', rupees(r.outstandingKitchenRefunds.totalPaise)],
  ];
  for (const [mode, n] of Object.entries(r.ordersByFoodPaymentMode)) rows.push([`Orders — ${mode}`, n]);
  return rows.map((row) => row.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
}
