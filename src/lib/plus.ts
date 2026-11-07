import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { orders, plusMemberships } from '@/lib/db/schema';
import { subscriptionGstBps, subscriptionCharge } from '@/lib/money/fees';
import { createRazorpayOrder } from '@/lib/payments/razorpay';
import { emit } from '@/lib/notify';
import { addMonthsIST, istParts } from '@/lib/time';
import { paymentsMode } from '@/lib/payments/mode';
import { assertLiveModeReady } from '@/lib/live-guard';

async function assertOn() {
  if (!(await getPlatformSettings()).plusEnabled) throw new ApiError(404, 'PadosiPlate Plus is not available');
}

export async function activePlus(userId: number, now: Date = new Date()) {
  const db = await getDb();
  const [m] = await db.select().from(plusMemberships).where(and(eq(plusMemberships.userId, userId), eq(plusMemberships.status, 'active'), gt(plusMemberships.endsAt, now))).limit(1);
  return m ?? null;
}

/** Start buying a month of Plus (explicit, one period, no auto-debit). Returns the checkout the page opens. */
export async function startPurchase(userId: number, explicitConsent: boolean) {
  await assertOn();
  if (!explicitConsent) throw new ApiError(400, 'Please confirm you want to buy Plus (it does not renew by itself)');
  const s = await getPlatformSettings();
  const charge = subscriptionCharge(s.plusPriceMonthlyPaise, subscriptionGstBps(s));
  await assertLiveModeReady(); // real money: configuration must be complete (no-op in mock and test-key modes)
  const db = await getDb();
  const [row] = await db.insert(plusMemberships).values({ userId, pricePaise: charge.basePaise, gstPaise: charge.gstPaise }).returning();
  const rzp = charge.totalPaise > 0 ? await createRazorpayOrder({ amountInPaise: charge.totalPaise, receipt: `pp-plus-${row.id}`, kind: 'plus', ref: row.id, notes: { userId: String(userId) } }) : null;
  if (rzp) await db.update(plusMemberships).set({ razorpayOrderId: rzp.id }).where(eq(plusMemberships.id, row.id));
  return { membershipId: row.id, amountInPaise: charge.totalPaise, mode: paymentsMode() === 'mock' || !rzp?.keyId ? ('mock' as const) : ('razorpay' as const), razorpayOrderId: rzp?.id ?? null, keyId: rzp?.keyId ?? null };
}

/** Exactly-once pending → active. Buying early stacks: the new month starts when the current one ends. */
export async function activatePurchase(membershipId: number, paymentId: string, now: Date = new Date()) {
  const db = await getDb();
  const [m] = await db.select().from(plusMemberships).where(eq(plusMemberships.id, membershipId));
  if (!m) throw new ApiError(404, 'Purchase not found');
  const current = await activePlus(m.userId, now);
  const start = current?.endsAt && current.endsAt > now ? current.endsAt : now;
  const [won] = await db.update(plusMemberships).set({ status: 'active', startsAt: start, endsAt: addMonthsIST(start, 1), razorpayPaymentId: paymentId }).where(and(eq(plusMemberships.id, membershipId), eq(plusMemberships.status, 'pending_payment'))).returning();
  return won ?? null;
}

/** Fee discount for this buyer on a fee of `baseFeePaise`: the Plus percentage, limited by what is left of this calendar month's cap (IST). */
export async function plusDiscountFor(userId: number, baseFeePaise: number, now: Date = new Date()): Promise<{ discountBps: number; membershipId: number | null }> {
  const s = await getPlatformSettings();
  if (!s.plusEnabled || baseFeePaise <= 0) return { discountBps: 0, membershipId: null };
  const m = await activePlus(userId, now);
  if (!m) return { discountBps: 0, membershipId: null };
  const p = istParts(now);
  const monthStart = new Date(Date.UTC(p.year, p.month - 1, 1) - 330 * 60_000);
  const db = await getDb();
  const [used] = await db.select({ n: sql<number>`coalesce(sum(${orders.plusDiscountPaise}), 0)::int` }).from(orders).where(and(eq(orders.buyerId, userId), gte(orders.createdAt, monthStart)));
  const remaining = Math.max(0, s.plusMonthlyDiscountCapPaise - Number(used?.n ?? 0));
  const wanted = Math.floor((baseFeePaise * s.plusFeeDiscountBps) / 10_000);
  const allowed = Math.min(wanted, remaining);
  return { discountBps: Math.floor((allowed / baseFeePaise) * 10_000), membershipId: m.id };
}

/** Three days before a Plus month ends, say so once. Nothing renews on its own. */
export async function plusReminders(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const rows = await db.select().from(plusMemberships).where(and(eq(plusMemberships.status, 'active'), gt(plusMemberships.endsAt, now)));
  let n = 0;
  for (const m of rows) {
    if (m.reminderSentAt || !m.endsAt || m.endsAt > soon) continue;
    await db.update(plusMemberships).set({ reminderSentAt: now }).where(eq(plusMemberships.id, m.id));
    await emit('plus_expiring', m.userId, { endsOn: m.endsAt.toISOString().slice(0, 10) }, now);
    n++;
  }
  return n;
}
