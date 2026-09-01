import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { complaints, listings, orders, sellerProfiles, societies, users } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';
import { getPlatformSettings } from '@/lib/db/platform';
import { pctOf } from '@/lib/money';

/**
 * Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md #99+).
 *
 * Weekly per-society pilot health, computed on demand from real rows — same
 * "derive it, don't cache a counter column" philosophy this codebase already
 * uses for the hygiene auto-pause count, seller badges, and slot caps. At
 * pilot scale (one society, a few hundred orders across 8 weeks) fetching
 * every relevant row once and reducing in JS is simpler and just as fast as
 * eight separate SQL group-bys, and it's the only way to compute the
 * cross-week cohort retention metric anyway (see below).
 *
 * Scope: only `home_delivery` orders count. Mall Mode is deferred this pilot
 * (FEATURE_MALL_MODE), and mall/restaurant orders have no meaningful
 * "society" tie (restaurant managers aren't assigned a society) — see
 * DECISIONS.md #99.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const PILOT_METRIC_WEEKS = 8;

export type FulfillmentMix = {
  selfPickupPct: number;
  sellerDeliveryPct: number;
  platformDeliveryPct: number;
};

export type WeeklyMetricRow = {
  weekNumber: number; // 1-based; weekNumber === weeks is the most recent (ending "now")
  weekStart: string; // ISO, inclusive
  weekEnd: string; // ISO, exclusive
  householdsRegistered: number;
  targetHouseholds: number;
  penetrationPct: number;
  weeklyActiveBuyers: number;
  repeatOrderRatePct: number;
  /** % of the cohort that first ordered 3 weeks earlier who ordered again this week. null until week 4. */
  week4RetentionPct: number | null;
  ordersThisWeek: number;
  aovInPaise: number;
  fulfillmentMix: FulfillmentMix;
  activeSellers: number;
  ordersPerActiveSeller: number;
  sellerChurnCount: number;
  sellerEligibleCount: number;
  sellerChurnPct: number;
  netRevenuePerOrderPaise: number;
  refundComplaintRatePct: number;
};

export type PilotTargets = {
  buyerRetentionTargetPct: number;
  refundComplaintRateTargetPct: number;
};

export type KillPivotCheckpoint = {
  checkpoint: 8 | 14;
  pilotWeek: number;
  due: boolean;
  weeksRemaining: number;
  status: 'pass' | 'fail' | 'pending';
  failingMetrics: string[];
  thresholds: { penetrationPct: number; retentionPct: number; refundComplaintRatePct: number };
};

function weekBounds(weekNumber: number, weeks: number, now: Date): { start: Date; end: Date } {
  const end = new Date(now.getTime() - (weeks - weekNumber) * WEEK_MS);
  const start = new Date(end.getTime() - WEEK_MS);
  return { start, end };
}

export type SocietyMetricsResult = {
  society: { id: number; name: string; targetHouseholds: number };
  weeks: WeeklyMetricRow[];
  targets: PilotTargets;
  killPivot: { week8: KillPivotCheckpoint; week14: KillPivotCheckpoint };
};

export async function getWeeklyMetrics(
  societyId: number,
  weeks: number = PILOT_METRIC_WEEKS,
  now: Date = new Date(),
): Promise<SocietyMetricsResult | null> {
  const db = await getDb();
  const [society] = await db.select().from(societies).where(eq(societies.id, societyId));
  if (!society) return null;
  const settings = await getPlatformSettings();

  const societyUsers = await db.select().from(users).where(eq(users.societyId, societyId));
  const buyerIds = new Set(societyUsers.filter((u) => u.role === 'buyer').map((u) => u.id));
  const sellerUsers = societyUsers.filter((u) => u.role === 'seller');
  const sellerIds = sellerUsers.map((u) => u.id);

  const sellerProfileRows = sellerIds.length
    ? await db.select().from(sellerProfiles).where(inArray(sellerProfiles.userId, sellerIds))
    : [];
  const approvedSellerIds = new Set(sellerProfileRows.filter((p) => p.isApproved).map((p) => p.userId));

  const listingRows = sellerIds.length
    ? await db.select().from(listings).where(inArray(listings.sellerId, sellerIds))
    : [];

  // home_delivery orders whose BUYER belongs to this society — a seller's own
  // society isn't what scopes this report; it's whose households are ordering.
  const homeOrders = await db.select().from(orders).where(eq(orders.type, 'home_delivery'));
  const societyOrders = homeOrders.filter((o) => buyerIds.has(o.buyerId));

  const orderIds = societyOrders.map((o) => o.id);
  const complaintRows = orderIds.length
    ? await db.select({ orderId: complaints.orderId }).from(complaints).where(inArray(complaints.orderId, orderIds))
    : [];
  const orderIdsWithComplaint = new Set(complaintRows.map((c) => c.orderId));

  // "Counted" orders for volume/AOV/mix/revenue/retention — excludes
  // cancelled orders (never charged, so they'd distort AOV/net-revenue and
  // shouldn't count as a buyer "being active" that week).
  const counted = societyOrders.filter((o) => o.status !== 'cancelled');

  // Each buyer's first-ever counted order — the anchor for both the repeat-
  // rate and week-4 cohort-retention metrics below.
  const firstOrderAt = new Map<number, Date>();
  for (const o of counted) {
    const existing = firstOrderAt.get(o.buyerId);
    if (!existing || o.createdAt < existing) firstOrderAt.set(o.buyerId, o.createdAt);
  }

  const rows: WeeklyMetricRow[] = [];
  for (let w = 1; w <= weeks; w++) {
    const { start: weekStart, end: weekEnd } = weekBounds(w, weeks, now);

    const householdsRegistered = societyUsers.filter(
      (u) => u.role === 'buyer' && u.createdAt <= weekEnd,
    ).length;
    const targetHouseholds = society.targetHouseholds;
    const penetrationPct = targetHouseholds > 0 ? (householdsRegistered / targetHouseholds) * 100 : 0;

    const weekOrders = counted.filter((o) => o.createdAt >= weekStart && o.createdAt < weekEnd);
    const activeBuyerIds = new Set(weekOrders.map((o) => o.buyerId));
    const weeklyActiveBuyers = activeBuyerIds.size;

    let repeatBuyers = 0;
    for (const bId of activeBuyerIds) {
      const first = firstOrderAt.get(bId);
      if (first && first < weekStart) repeatBuyers++;
    }
    const repeatOrderRatePct = weeklyActiveBuyers > 0 ? (repeatBuyers / weeklyActiveBuyers) * 100 : 0;

    // Week-4 retention: the cohort whose first-ever order landed exactly 3
    // weeks before this one (weeks W, W+1, W+2, W+3 = their 4th week of
    // lifecycle) — % of that cohort who ordered again THIS week. null until
    // week 4 (no cohort 3 weeks back yet).
    let week4RetentionPct: number | null = null;
    if (w >= 4) {
      const { start: cohortStart, end: cohortEnd } = weekBounds(w - 3, weeks, now);
      const cohortBuyerIds: number[] = [];
      for (const [buyerId, firstAt] of firstOrderAt) {
        if (firstAt >= cohortStart && firstAt < cohortEnd) cohortBuyerIds.push(buyerId);
      }
      if (cohortBuyerIds.length > 0) {
        const retained = cohortBuyerIds.filter((id) => activeBuyerIds.has(id)).length;
        week4RetentionPct = (retained / cohortBuyerIds.length) * 100;
      }
    }

    const ordersThisWeek = weekOrders.length;
    const grossTotal = weekOrders.reduce((s, o) => s + o.totalInPaise, 0);
    const aovInPaise = ordersThisWeek > 0 ? Math.round(grossTotal / ordersThisWeek) : 0;

    const mixCount = { self_pickup: 0, seller_delivery: 0, platform_delivery: 0 };
    for (const o of weekOrders) mixCount[o.fulfillmentType]++;
    const fulfillmentMix: FulfillmentMix = {
      selfPickupPct: ordersThisWeek > 0 ? (mixCount.self_pickup / ordersThisWeek) * 100 : 0,
      sellerDeliveryPct: ordersThisWeek > 0 ? (mixCount.seller_delivery / ordersThisWeek) * 100 : 0,
      platformDeliveryPct: ordersThisWeek > 0 ? (mixCount.platform_delivery / ordersThisWeek) * 100 : 0,
    };

    const sellerOrdersThisWeek = weekOrders.filter((o) => o.sellerId != null);
    const activeSellers = new Set(sellerOrdersThisWeek.map((o) => o.sellerId as number)).size;
    const ordersPerActiveSeller = activeSellers > 0 ? sellerOrdersThisWeek.length / activeSellers : 0;

    // Seller churn: among APPROVED sellers who'd registered by this week's
    // end, how many have posted no listing (created or kept on the shelf) in
    // the trailing 14 days — a proxy for "went quiet," since this schema has
    // no listing-level update/deactivation history to check a precise
    // active-listing timeline against (documented approximation — DECISIONS.md #99).
    const eligibleSellers = sellerUsers.filter(
      (u) => u.createdAt <= weekEnd && approvedSellerIds.has(u.id),
    );
    const churnCutoff = new Date(weekEnd.getTime() - CHURN_WINDOW_MS);
    let sellerChurnCount = 0;
    for (const s of eligibleSellers) {
      const hasRecentListing = listingRows.some(
        (l) => l.sellerId === s.id && l.createdAt <= weekEnd && l.createdAt > churnCutoff,
      );
      if (!hasRecentListing) sellerChurnCount++;
    }
    const sellerChurnPct = eligibleSellers.length > 0 ? (sellerChurnCount / eligibleSellers.length) * 100 : 0;

    // Net revenue per order = platform's own take (commission + buyer
    // platform fee — NOT GST, which the platform collects only to remit to
    // the government as the deemed supplier, never its own revenue), less an
    // estimated gateway fee and this week's refunds. Applied against
    // totalInPaise (what actually moved through the gateway), deliberately
    // NOT subtotalInPaise as src/lib/payouts.ts's seller-ledger gateway-fee
    // line uses — that ledger is estimating a cost attributable to the
    // seller's payout, this is estimating the platform's own gateway cost on
    // the full amount it actually processed (DECISIONS.md #99).
    const grossCommission = weekOrders.reduce((s, o) => s + o.commissionInPaise, 0);
    const grossPlatformFee = weekOrders.reduce((s, o) => s + o.platformFeeInPaise, 0);
    const gatewayFeeEstimate = pctOf(grossTotal, DEFAULTS.gatewayFeeEstimatePct);
    const refunds = weekOrders.reduce((s, o) => s + o.refundInPaise, 0);
    const netRevenueTotal = grossCommission + grossPlatformFee - gatewayFeeEstimate - refunds;
    const netRevenuePerOrderPaise = ordersThisWeek > 0 ? Math.round(netRevenueTotal / ordersThisWeek) : 0;

    const flaggedOrders = weekOrders.filter(
      (o) => o.refundInPaise > 0 || orderIdsWithComplaint.has(o.id),
    ).length;
    const refundComplaintRatePct = ordersThisWeek > 0 ? (flaggedOrders / ordersThisWeek) * 100 : 0;

    rows.push({
      weekNumber: w,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      householdsRegistered,
      targetHouseholds,
      penetrationPct,
      weeklyActiveBuyers,
      repeatOrderRatePct,
      week4RetentionPct,
      ordersThisWeek,
      aovInPaise,
      fulfillmentMix,
      activeSellers,
      ordersPerActiveSeller,
      sellerChurnCount,
      sellerEligibleCount: eligibleSellers.length,
      sellerChurnPct,
      netRevenuePerOrderPaise,
      refundComplaintRatePct,
    });
  }

  // Pilot week number = how many 7-day windows have elapsed since this
  // society's very first buyer registered (its real pilot start) — NOT just
  // "how many weeks does this table have," so the week-8/14 checkpoints stay
  // correct as real time passes beyond this initial 8-week seed window.
  const earliestBuyer = societyUsers
    .filter((u) => u.role === 'buyer')
    .reduce((min: Date | null, u) => (!min || u.createdAt < min ? u.createdAt : min), null);
  const pilotWeek = earliestBuyer ? Math.floor((now.getTime() - earliestBuyer.getTime()) / WEEK_MS) + 1 : 0;

  const latest = rows[rows.length - 1] as WeeklyMetricRow | undefined;
  const latestRetention = [...rows].reverse().find((r) => r.week4RetentionPct != null)?.week4RetentionPct ?? null;

  function evaluate(checkpoint: 8 | 14, penetrationPct: number, retentionPct: number): KillPivotCheckpoint {
    const due = pilotWeek >= checkpoint;
    const thresholds = { penetrationPct, retentionPct, refundComplaintRatePct: DEFAULTS.refundComplaintRateTargetPct };
    if (!due) {
      return {
        checkpoint,
        pilotWeek,
        due,
        weeksRemaining: checkpoint - pilotWeek,
        status: 'pending',
        failingMetrics: [],
        thresholds,
      };
    }
    const failing: string[] = [];
    if (!latest || latest.penetrationPct < penetrationPct) {
      failing.push(`Penetration below ${penetrationPct}% of target households`);
    }
    if (latestRetention == null || latestRetention < retentionPct) {
      failing.push(`Week-4 buyer retention below ${retentionPct}%`);
    }
    if (!latest || latest.refundComplaintRatePct > DEFAULTS.refundComplaintRateTargetPct) {
      failing.push(`Refund/complaint rate above ${DEFAULTS.refundComplaintRateTargetPct}%`);
    }
    return {
      checkpoint,
      pilotWeek,
      due,
      weeksRemaining: 0,
      status: failing.length > 0 ? 'fail' : 'pass',
      failingMetrics: failing,
      thresholds,
    };
  }

  return {
    society: { id: society.id, name: society.name, targetHouseholds: society.targetHouseholds },
    weeks: rows,
    targets: {
      buyerRetentionTargetPct: DEFAULTS.buyerRetentionTargetPct,
      refundComplaintRateTargetPct: DEFAULTS.refundComplaintRateTargetPct,
    },
    killPivot: {
      week8: evaluate(8, settings.killWeek8PenetrationPct, settings.killWeek8RetentionPct),
      week14: evaluate(14, settings.killWeek14PenetrationPct, settings.killWeek14RetentionPct),
    },
  };
}

/** CSV export of the weekly table — one row per week, mirrors WeeklyMetricRow. */
export function toWeeklyMetricsCsv(societyName: string, result: SocietyMetricsResult): string {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = [
    'Society',
    'Week',
    'Week start',
    'Week end',
    'Households registered',
    'Target households',
    'Penetration %',
    'Weekly active buyers',
    'Repeat order rate %',
    'Week-4 retention %',
    'Orders this week',
    'AOV (INR)',
    'Self-pickup %',
    'Seller-delivery %',
    'Platform-delivery %',
    'Active sellers',
    'Orders per active seller',
    'Seller churn count',
    'Seller churn %',
    'Net revenue per order (INR)',
    'Refund/complaint rate %',
  ];
  const lines = [header.join(',')];
  for (const w of result.weeks) {
    lines.push(
      [
        escape(societyName),
        w.weekNumber,
        w.weekStart.slice(0, 10),
        w.weekEnd.slice(0, 10),
        w.householdsRegistered,
        w.targetHouseholds,
        w.penetrationPct.toFixed(1),
        w.weeklyActiveBuyers,
        w.repeatOrderRatePct.toFixed(1),
        w.week4RetentionPct == null ? '' : w.week4RetentionPct.toFixed(1),
        w.ordersThisWeek,
        (w.aovInPaise / 100).toFixed(2),
        w.fulfillmentMix.selfPickupPct.toFixed(1),
        w.fulfillmentMix.sellerDeliveryPct.toFixed(1),
        w.fulfillmentMix.platformDeliveryPct.toFixed(1),
        w.activeSellers,
        w.ordersPerActiveSeller.toFixed(1),
        w.sellerChurnCount,
        w.sellerChurnPct.toFixed(1),
        (w.netRevenuePerOrderPaise / 100).toFixed(2),
        w.refundComplaintRatePct.toFixed(1),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}
