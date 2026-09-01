import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orders, payouts, sellerFyPayoutTotals, sellerProfiles } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';
import { pctOf } from '@/lib/money';

/**
 * Payouts — merchant-of-record settlement (DECISIONS.md #51+).
 *
 * The platform is the merchant of record: payments settle to GharSe, and
 * cooks are paid out as disclosed suppliers on a manual T+2 cadence (no
 * automated bank rails yet — Razorpay Route stays a stub, see
 * src/lib/payments/settlements.ts). "T+2" here means: an order only becomes
 * eligible for a payout batch once PAYOUT_HOLD_HOURS have passed since it
 * completed, giving a buffer for same-day disputes/refunds before money
 * moves. No cron/workers (matches the rest of this app) — an admin clicks
 * "Generate T+2 batch" and this sweeps whatever has crossed the line.
 */

export const PAYOUT_HOLD_HOURS = 48;

/**
 * Indian financial year label (Apr–Mar) for a given date, e.g. "2026-27".
 * Used to key seller_fy_payout_totals for the Sec 194-O TDS threshold.
 */
export function fyLabel(d: Date = new Date()): string {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // April (month index 3) starts a new FY
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export type PayoutBatchResult = {
  payoutsCreated: number;
  sellersCount: number;
  ordersSwept: number;
};

/**
 * "Generate T+2 batch": groups every delivered/picked-up order that (a) isn't
 * already in a payout and (b) completed more than PAYOUT_HOLD_HOURS ago, by
 * seller, and inserts one pending `payouts` row per seller covering that
 * group. Idempotent by construction — orders get tagged with `payoutId` the
 * moment they're swept in, so re-running only ever picks up orders that have
 * newly crossed the 48h mark since the last run.
 */
export async function generatePayoutBatch(now: Date = new Date()): Promise<PayoutBatchResult> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - PAYOUT_HOLD_HOURS * 60 * 60 * 1000);

  const eligible = await db
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, ['delivered', 'picked_up']),
        isNull(orders.payoutId),
        lte(orders.updatedAt, cutoff),
      ),
    );

  // Seller-scoped only — mall/restaurant orders have sellerId null and are
  // out of scope for this pivot (Mall Mode is deferred this pilot anyway).
  const bySeller = new Map<number, typeof eligible>();
  for (const o of eligible) {
    if (!o.sellerId) continue;
    const list = bySeller.get(o.sellerId);
    if (list) list.push(o);
    else bySeller.set(o.sellerId, [o]);
  }

  // Pilot Hardening v2 — Phase 5 (Trust & hygiene, DECISIONS.md #73+): any
  // order carrying a complaint refund that hasn't been deducted from a payout
  // yet gets swept into whichever payout this run produces for its seller —
  // including orders from an EARLIER (possibly already-paid) batch, since a
  // refund can land after that order was already paid out. Kept in a
  // separate map from `bySeller` because these orders may already have a
  // payoutId (already counted toward an earlier batch's own gross sales) and
  // must never be re-added to this batch's orderCount/grossSalesInPaise.
  const undeductedRefunds = await db
    .select({ id: orders.id, sellerId: orders.sellerId, refundInPaise: orders.refundInPaise })
    .from(orders)
    .where(and(gt(orders.refundInPaise, 0), isNull(orders.refundDeductedAt)));
  const refundBySeller = new Map<number, { amountInPaise: number; orderIds: number[] }>();
  for (const o of undeductedRefunds) {
    if (!o.sellerId) continue;
    const entry = refundBySeller.get(o.sellerId) ?? { amountInPaise: 0, orderIds: [] };
    entry.amountInPaise += o.refundInPaise;
    entry.orderIds.push(o.id);
    refundBySeller.set(o.sellerId, entry);
  }

  const fy = fyLabel(now);
  let payoutsCreated = 0;
  let ordersSwept = 0;
  const sellerIds = new Set<number>([...bySeller.keys(), ...refundBySeller.keys()]);

  for (const sellerId of sellerIds) {
    const sellerOrders = bySeller.get(sellerId) ?? [];
    const refundDeduction = refundBySeller.get(sellerId)?.amountInPaise ?? 0;
    if (sellerOrders.length === 0 && refundDeduction === 0) continue; // defensive; shouldn't happen

    const grossSales = sellerOrders.reduce((s, o) => s + o.subtotalInPaise, 0);
    // Sum each order's own commissionInPaise (the rate actually in force when
    // it was placed) rather than re-applying today's commissionHomePct — a
    // later admin rate change must never retroactively rewrite an already-
    // charged order's commission (DECISIONS.md #52).
    const commission = sellerOrders.reduce((s, o) => s + o.commissionInPaise, 0);
    const gatewayFeeEstimate = pctOf(grossSales, DEFAULTS.gatewayFeeEstimatePct);

    const [fyRow] = await db
      .select()
      .from(sellerFyPayoutTotals)
      .where(and(eq(sellerFyPayoutTotals.sellerId, sellerId), eq(sellerFyPayoutTotals.fyLabel, fy)));
    const priorFyTotal = fyRow?.grossPayoutInPaise ?? 0;
    const newFyTotal = priorFyTotal + grossSales;
    // Sec 194-O TDS: once this seller's cumulative FY gross sales crosses the
    // ₹5,00,000 threshold, TDS applies — pragmatically to this whole batch's
    // gross sales, not a precise pro-rated split of the exact rupee that
    // crosses it (DECISIONS.md #54; fine at pilot scale, revisit before scale-up).
    const tds =
      newFyTotal > DEFAULTS.tds194OThresholdPaise
        ? Math.round(grossSales * (DEFAULTS.tds194OPct / 100))
        : 0;

    // Refunds are a clean top-line deduction, not baked back into
    // grossSales/commission — same "never rewrite a historical figure"
    // reasoning as #52/#54 above (DECISIONS.md #73+).
    const netPayable = grossSales - commission - gatewayFeeEstimate - tds - refundDeduction;

    const [profile] = await db
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, sellerId));

    const periodStart =
      sellerOrders.length > 0
        ? sellerOrders.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), sellerOrders[0].createdAt)
        : now;
    const periodEnd =
      sellerOrders.length > 0
        ? sellerOrders.reduce((max, o) => (o.updatedAt > max ? o.updatedAt : max), sellerOrders[0].updatedAt)
        : now;

    const [payout] = await db
      .insert(payouts)
      .values({
        sellerId,
        periodStart,
        periodEnd,
        orderCount: sellerOrders.length,
        grossSalesInPaise: grossSales,
        commissionInPaise: commission,
        gatewayFeeEstimateInPaise: gatewayFeeEstimate,
        tds194OInPaise: tds,
        refundDeductionInPaise: refundDeduction,
        netPayableInPaise: netPayable,
        payoutDestinationSnapshot: profile?.payoutVpaOrBank ?? null,
      })
      .returning();

    if (sellerOrders.length > 0) {
      await db
        .update(orders)
        .set({ payoutId: payout.id })
        .where(
          inArray(
            orders.id,
            sellerOrders.map((o) => o.id),
          ),
        );
    }
    const deductedOrderIds = refundBySeller.get(sellerId)?.orderIds ?? [];
    if (deductedOrderIds.length > 0) {
      await db.update(orders).set({ refundDeductedAt: now }).where(inArray(orders.id, deductedOrderIds));
    }

    if (fyRow) {
      await db
        .update(sellerFyPayoutTotals)
        .set({ grossPayoutInPaise: newFyTotal, updatedAt: now })
        .where(eq(sellerFyPayoutTotals.id, fyRow.id));
    } else {
      await db.insert(sellerFyPayoutTotals).values({
        sellerId,
        fyLabel: fy,
        grossPayoutInPaise: newFyTotal,
        updatedAt: now,
      });
    }

    payoutsCreated += 1;
    ordersSwept += sellerOrders.length;
  }

  return { payoutsCreated, sellersCount: sellerIds.size, ordersSwept };
}

export type PayoutCsvRow = {
  id: number;
  sellerName: string;
  destination: string;
  amountInPaise: number;
  orderCount: number;
};

/** CSV for the admin to act on manually: name, VPA/bank, amount — one row per pending payout. */
export function toPayoutCsv(rows: PayoutCsvRow[]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ['Payout ID', 'Seller', 'VPA / Bank', 'Amount (INR)', 'Orders'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        escape(r.sellerName),
        escape(r.destination || 'NOT ON FILE — contact seller'),
        (r.amountInPaise / 100).toFixed(2),
        r.orderCount,
      ].join(','),
    );
  }
  return lines.join('\r\n');
}
