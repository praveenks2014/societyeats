import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { fssaiApplications, grievances, kitchenSubscriptions, orders, referralCredits, reviews, sellerProfiles, societies, users, visitCounters } from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';
import { fssaiTier } from '@/lib/fssai/tier';
import { istDateString } from '@/lib/time';
import { COMPLETED_STATES } from '@/lib/orders/state';

const HOME = 'home_delivery';
/** A true median: the middle value, or the mean of the two middle values for an even count. */
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export type Overview = {
  buyerFunnel: { visits: number; signUps: number; verified: number; firstOrder: number; repeat: number };
  kitchenFunnel: { applied: number; upiVerified: number; fssai: { none: number; applied: number; provisional: number; verified: number; blocked: number }; approved: number; firstOrder: number };
  money: { gmvPaise: number; feeRevenuePaise: number; refundsPaise: number; creditsIssuedPaise: number; planRevenuePaise: number; completedOrders: number };
  quality: {
    orders: number;
    cancellationRatePct: number | null;
    cancellationsByCause: { seller_declined: number; seller_cancelled: number; kitchen_missed: number; buyer: number; buyer_unpaid_or_no_show: number };
    disputeRatePct: number | null;
    medianAcceptMinutes: number | null;
    medianDoorToCompleteMinutes: number | null;
    avgRating: number | null;
    ratings: number;
  };
};
export type OverviewResult = { windowDays: number; from: string; to: string; global: Overview; bySociety: { societyId: number; name: string; metrics: Overview }[] };

/**
 * The numbers the founders steer by, for a window of days: buyer and kitchen funnels, money, and quality — platform-wide and for every
 * society. Derived on demand from real rows (no cached counters), same philosophy as the weekly pilot table.
 */
export async function metricsOverview(windowDays = 30, now: Date = new Date()): Promise<OverviewResult> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const from = new Date(now.getTime() - windowDays * 86_400_000);
  const socs = await db.select({ id: societies.id, name: societies.name }).from(societies).orderBy(societies.id);

  const allUsers = await db.select({ id: users.id, role: users.role, societyId: users.societyId, verified: users.emailVerifiedAt, createdAt: users.createdAt }).from(users);
  const userSociety = new Map(allUsers.map((u) => [u.id, u.societyId]));
  const home = await db.select().from(orders).where(eq(orders.type, HOME));
  const inWin = home.filter((o) => o.createdAt >= from && o.createdAt < now);
  const profiles = await db.select().from(sellerProfiles);
  const apps = await db.select().from(fssaiApplications);
  const appBySeller = new Map<number, typeof apps[number]>();
  for (const a of apps.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) appBySeller.set(a.sellerId, a);
  const visits = await db.select().from(visitCounters).where(and(gte(visitCounters.day, istDateString(from)), sql`${visitCounters.day} <= ${istDateString(now)}`));
  const subs = await db.select().from(kitchenSubscriptions).where(and(inArray(kitchenSubscriptions.status, ['active', 'grace', 'expired']), gte(kitchenSubscriptions.paidAt, from)));
  const credits = await db.select().from(referralCredits).where(and(gte(referralCredits.createdAt, from), lt(referralCredits.createdAt, now)));
  const ratings = await db.select({ rating: reviews.rating, orderId: reviews.orderId, createdAt: reviews.createdAt }).from(reviews).where(gte(reviews.createdAt, from));
  const orderById = new Map(home.map((o) => [o.id, o]));
  const disputes = await db.select({ orderId: grievances.orderId, kind: grievances.kind, createdAt: grievances.createdAt }).from(grievances).where(and(inArray(grievances.kind, ['dispute_payment', 'dispute_food', 'dispute_quality']), gte(grievances.createdAt, from)));

  // first-ever and repeat orders per buyer across ALL time (a funnel counts a buyer once)
  const ordersByBuyer = new Map<number, number>();
  for (const o of home) if (!['fee_pending', 'expired'].includes(o.status)) ordersByBuyer.set(o.buyerId, (ordersByBuyer.get(o.buyerId) ?? 0) + 1);
  const ordersBySeller = new Map<number, number>();
  for (const o of home) if (o.sellerId && !['fee_pending', 'expired'].includes(o.status)) ordersBySeller.set(o.sellerId, (ordersBySeller.get(o.sellerId) ?? 0) + 1);

  const build = (soc: number | null): Overview => {
    const inSoc = (uid: number | null | undefined) => soc == null || (uid != null && userSociety.get(uid) === soc);
    const buyers = allUsers.filter((u) => u.role === 'buyer' && u.createdAt >= from && u.createdAt < now && inSoc(u.id));
    const myVisits = visits.filter((v) => (soc == null ? true : v.societyId === soc)).reduce((a, v) => a + v.count, 0);
    const orderSoc = (o: typeof home[number]) => soc == null || userSociety.get(o.buyerId) === soc;
    const winOrders = inWin.filter(orderSoc);
    const sellerRows = profiles.filter((p) => inSoc(p.userId));
    const tiers = { none: 0, applied: 0, provisional: 0, verified: 0, blocked: 0 };
    for (const p of sellerRows) tiers[fssaiTier(p, appBySeller.get(p.userId) ?? null, { deemedDays: settings.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: settings.provisionalMaxDays, now })]++;

    const completed = winOrders.filter((o) => COMPLETED_STATES.includes(o.status as never) && o.completedAt && o.completedAt >= from);
    const kept = winOrders.filter((o) => o.onlineChargeInPaise > 0).reduce((a, o) => a + Math.max(0, o.onlineChargeInPaise - o.feeRefundedInPaise), 0);
    const cause = { seller_declined: 0, seller_cancelled: 0, kitchen_missed: 0, buyer: 0, buyer_unpaid_or_no_show: 0 };
    for (const o of winOrders) {
      if (o.status === 'cancelled_by_seller' || o.status === 'cancelled') o.acceptedAt ? cause.seller_cancelled++ : cause.seller_declined++;
      else if (o.status === 'cancelled_auto') cause.kitchen_missed++;
      else if (o.status === 'cancelled_by_buyer') cause.buyer++;
      else if (o.status === 'cancelled_buyer_unpaid' || o.status === 'no_show_buyer') cause.buyer_unpaid_or_no_show++;
    }
    const cancelled = Object.values(cause).reduce((a, b) => a + b, 0);
    const booked = winOrders.filter((o) => !['fee_pending', 'expired'].includes(o.status));
    const accept = booked.filter((o) => o.acceptedAt && o.bookedAt).map((o) => (o.acceptedAt!.getTime() - o.bookedAt!.getTime()) / 60_000);
    const door = completed.filter((o) => o.atDoorAt && o.completedAt).map((o) => (o.completedAt!.getTime() - o.atDoorAt!.getTime()) / 60_000);
    const rated = ratings.filter((r) => { const o = orderById.get(r.orderId); return o && orderSoc(o); });
    const myDisputes = disputes.filter((d) => { const o = d.orderId ? orderById.get(d.orderId) : null; return o && orderSoc(o); });
    const mySubs = subs.filter((x) => inSoc(x.sellerId));

    return {
      buyerFunnel: {
        visits: myVisits,
        signUps: buyers.length,
        verified: buyers.filter((u) => u.verified).length,
        firstOrder: buyers.filter((u) => (ordersByBuyer.get(u.id) ?? 0) >= 1).length,
        repeat: buyers.filter((u) => (ordersByBuyer.get(u.id) ?? 0) >= 2).length,
      },
      kitchenFunnel: {
        applied: sellerRows.filter((p) => p.listingSubmittedAt && p.listingSubmittedAt >= from).length,
        upiVerified: sellerRows.filter((p) => p.upiVerifyStatus === 'verified').length,
        fssai: tiers,
        approved: sellerRows.filter((p) => p.listingState === 'approved').length,
        firstOrder: sellerRows.filter((p) => (ordersBySeller.get(p.userId) ?? 0) >= 1).length,
      },
      money: {
        gmvPaise: completed.reduce((a, o) => a + o.foodTotalInPaise, 0),
        feeRevenuePaise: kept,
        refundsPaise: winOrders.reduce((a, o) => a + o.feeRefundedInPaise, 0),
        creditsIssuedPaise: credits.filter((c) => c.source !== 'referral' && (soc == null || userSociety.get(c.buyerId) === soc)).reduce((a, c) => a + c.amountInPaise, 0),
        planRevenuePaise: mySubs.reduce((a, x) => a + x.pricePaiseSnapshot + x.gstPaise, 0),
        completedOrders: completed.length,
      },
      quality: {
        orders: booked.length,
        cancellationRatePct: pct(cancelled, booked.length),
        cancellationsByCause: cause,
        disputeRatePct: pct(myDisputes.length, booked.length),
        medianAcceptMinutes: median(accept) == null ? null : Math.round(median(accept)! * 10) / 10,
        medianDoorToCompleteMinutes: median(door) == null ? null : Math.round(median(door)! * 10) / 10,
        avgRating: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating, 0) / rated.length) * 10) / 10 : null,
        ratings: rated.length,
      },
    };
  };

  return { windowDays, from: from.toISOString(), to: now.toISOString(), global: build(null), bySociety: socs.map((s) => ({ societyId: s.id, name: s.name, metrics: build(s.id) })) };
}
