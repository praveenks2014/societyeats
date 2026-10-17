import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { notify, notifyUser } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { kitchenSubscriptions, notifications, subscriptionPlans } from '@/lib/db/schema';
import { effectiveGstBps, subscriptionCharge } from '@/lib/money';
import { createRazorpayOrder, receiptFor } from '@/lib/payments/razorpay';
import { addDays, DAY_MS } from '@/lib/time';
import { parseReminderDays } from '@/lib/settings/defs';
import { effectiveStatus, nextPeriod } from './status';
import { sellerSubscriptions } from './queries';

/**
 * Kitchen subscription lifecycle — the platform's second revenue line.
 * One-time Razorpay payment per period (no auto-debit this phase). Renewing
 * early stacks: the new period starts at the current end.
 */
export type SubscriptionCheckout =
  | { mode: 'mock'; subscriptionId: number; amountInPaise: number }
  | { mode: 'razorpay'; subscriptionId: number; amountInPaise: number; keyId: string; razorpayOrderId: string };

/** Creates (or reuses) a pending subscription for `planId` and its Razorpay order. */
export async function startSubscriptionPayment(sellerId: number, planId: number): Promise<SubscriptionCheckout> {
  const db = await getDb();
  const [plan] = await db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.active, true)));
  if (!plan) throw new ApiError(404, 'That plan is not available');
  const settings = await getPlatformSettings();
  const gstBps = effectiveGstBps(settings.platformFeeGstBps, settings.platformGstin);
  const charge = subscriptionCharge(plan.pricePaise, gstBps);

  const pendings = await db
    .select()
    .from(kitchenSubscriptions)
    .where(and(eq(kitchenSubscriptions.sellerId, sellerId), eq(kitchenSubscriptions.status, 'pending_payment')))
    .orderBy(desc(kitchenSubscriptions.id));
  const reusable = pendings.find((p) => p.planId === planId && p.pricePaiseSnapshot + p.gstPaise === charge.totalPaise && p.razorpayOrderId && Date.now() - p.createdAt.getTime() < 30 * 60_000);
  let sub = reusable;
  if (!sub) {
    // Abandoned earlier attempts are cancelled so only one payable row exists.
    const stale = pendings.map((p) => p.id);
    if (stale.length) await db.update(kitchenSubscriptions).set({ status: 'cancelled', notes: 'Superseded by a new checkout' }).where(inArray(kitchenSubscriptions.id, stale));
    [sub] = await db
      .insert(kitchenSubscriptions)
      .values({
        sellerId,
        planId: plan.id,
        planNameSnapshot: plan.name,
        durationMonthsSnapshot: plan.durationMonths,
        pricePaiseSnapshot: charge.basePaise,
        gstPaise: charge.gstPaise,
        gstBpsSnapshot: gstBps,
        status: 'pending_payment',
      })
      .returning();
    const rzp = await createRazorpayOrder({ amountInPaise: charge.totalPaise, receipt: receiptFor('s', sub.id), notes: { subscriptionId: String(sub.id), sellerId: String(sellerId) } });
    [sub] = await db.update(kitchenSubscriptions).set({ razorpayOrderId: rzp.id }).where(eq(kitchenSubscriptions.id, sub.id)).returning();
    if (!isMockMode() && rzp.keyId) return { mode: 'razorpay', subscriptionId: sub.id, amountInPaise: charge.totalPaise, keyId: rzp.keyId, razorpayOrderId: rzp.id };
    return { mode: 'mock', subscriptionId: sub.id, amountInPaise: charge.totalPaise };
  }
  if (!isMockMode()) {
    const keyId = process.env.RAZORPAY_KEY_ID!;
    return { mode: 'razorpay', subscriptionId: sub.id, amountInPaise: charge.totalPaise, keyId, razorpayOrderId: sub.razorpayOrderId! };
  }
  return { mode: 'mock', subscriptionId: sub.id, amountInPaise: charge.totalPaise };
}

/** Exactly-once pending_payment → active (period stacked after any current one). */
export async function markSubscriptionPaid(subId: number, info: { razorpayPaymentId?: string } = {}): Promise<{ won: boolean }> {
  const db = await getDb();
  const now = new Date();
  const paymentId = info.razorpayPaymentId ?? `pay_MOCKSUB${subId}_${now.getTime().toString(36)}`;
  const res = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.id, subId));
    if (!cur) return { won: false as const, row: null };
    const others = await tx.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.sellerId, cur.sellerId));
    const { startsAt, endsAt } = nextPeriod(others.filter((o) => o.id !== subId), cur.durationMonthsSnapshot, now);
    const [row] = await tx
      .update(kitchenSubscriptions)
      .set({ status: 'active', startsAt, endsAt, razorpayPaymentId: paymentId, paidAt: now })
      .where(and(eq(kitchenSubscriptions.id, subId), eq(kitchenSubscriptions.status, 'pending_payment')))
      .returning();
    return row ? { won: true as const, row } : { won: false as const, row: cur };
  });
  if (!res.won) {
    if (res.row && res.row.status === 'cancelled' && !res.row.paidAt) {
      // Paid against a superseded checkout: take it, then give the money back.
      await db.update(kitchenSubscriptions).set({ razorpayPaymentId: paymentId, paidAt: now }).where(eq(kitchenSubscriptions.id, subId));
      try {
        const { refundSubscriptionPayment } = await import('@/lib/payments/refunds');
        await refundSubscriptionPayment({ subscriptionId: subId, reason: 'Payment received for a superseded checkout', adminId: 0 });
      } catch {
        /* surfaced in the admin refunds list */
      }
    }
    return { won: false };
  }
  const row = res.row!;
  await notifyUser(row.sellerId, 'Subscription active ✅', `${row.planNameSnapshot} is active until ${row.endsAt!.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}. Invoice available in Subscription.`, '/seller/subscription', { email: true, emailKind: 'subscription_paid' });
  return { won: true };
}

// ---------- admin tools ----------

export async function grantSubscription(opts: { adminId: number; sellerId: number; months: number; reason: string }) {
  if (!opts.reason.trim()) throw new ApiError(400, 'A reason is required');
  if (!Number.isInteger(opts.months) || opts.months < 1 || opts.months > 12) throw new ApiError(400, 'Months must be between 1 and 12');
  const db = await getDb();
  const now = new Date();
  const subs = await sellerSubscriptions(opts.sellerId);
  const { startsAt, endsAt } = nextPeriod(subs, opts.months, now);
  const [row] = await db
    .insert(kitchenSubscriptions)
    .values({ sellerId: opts.sellerId, planNameSnapshot: 'Complimentary', durationMonthsSnapshot: opts.months, status: 'waived', startsAt, endsAt, grantedByAdminId: opts.adminId, notes: opts.reason.trim(), paidAt: null })
    .returning();
  await recordAudit({ actorId: opts.adminId, action: 'subscription.grant', targetType: 'subscription', targetId: row.id, meta: { sellerId: opts.sellerId, months: opts.months, reason: opts.reason } });
  await notifyUser(opts.sellerId, 'You have been given free listing time 🎁', `${opts.months} month(s) complimentary — ${opts.reason.trim()}`, '/seller/subscription', { email: true, emailKind: 'subscription_granted' });
  return row;
}

export async function extendSubscription(opts: { adminId: number; subscriptionId: number; days: number; reason: string }) {
  if (!opts.reason.trim()) throw new ApiError(400, 'A reason is required');
  if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 366) throw new ApiError(400, 'Days must be between 1 and 366');
  const db = await getDb();
  const [sub] = await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.id, opts.subscriptionId));
  if (!sub || !sub.endsAt) throw new ApiError(404, 'Subscription period not found');
  if (['cancelled', 'pending_payment'].includes(sub.status)) throw new ApiError(409, 'That period is not running');
  const [row] = await db
    .update(kitchenSubscriptions)
    .set({ endsAt: addDays(sub.endsAt, opts.days), notes: [sub.notes, `Extended ${opts.days}d: ${opts.reason.trim()}`].filter(Boolean).join(' | ') })
    .where(eq(kitchenSubscriptions.id, sub.id))
    .returning();
  await recordAudit({ actorId: opts.adminId, action: 'subscription.extend', targetType: 'subscription', targetId: sub.id, meta: { days: opts.days, reason: opts.reason } });
  await notify(sub.sellerId, 'Your subscription was extended', `${opts.days} extra day(s): ${opts.reason.trim()}`, '/seller/subscription');
  return row;
}

export async function cancelSubscription(opts: { adminId: number; subscriptionId: number; reason: string }) {
  if (!opts.reason.trim()) throw new ApiError(400, 'A reason is required');
  const db = await getDb();
  const now = new Date();
  const [sub] = await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.id, opts.subscriptionId));
  if (!sub) throw new ApiError(404, 'Subscription period not found');
  if (sub.status === 'cancelled') throw new ApiError(409, 'Already cancelled');
  const [row] = await db
    .update(kitchenSubscriptions)
    .set({ status: 'cancelled', endsAt: sub.endsAt && sub.endsAt > now && sub.startsAt && sub.startsAt <= now ? now : sub.endsAt, notes: [sub.notes, `Cancelled: ${opts.reason.trim()}`].filter(Boolean).join(' | ') })
    .where(eq(kitchenSubscriptions.id, sub.id))
    .returning();
  await recordAudit({ actorId: opts.adminId, action: 'subscription.cancel', targetType: 'subscription', targetId: sub.id, meta: { reason: opts.reason } });
  await notifyUser(sub.sellerId, 'A subscription period was cancelled', opts.reason.trim(), '/seller/subscription', { email: true, emailKind: 'subscription_cancelled' });
  return row;
}

// ---------- scheduled sweep ----------

/**
 * Persists time-based transitions (active → grace → expired) and sends
 * renewal reminders. Visibility never depends on this running — it is
 * derived from the dates (see effectiveStatus) — the sweep only keeps the
 * stored status honest and sends the emails. Reminders are de-duplicated by
 * (user, title).
 */
export async function syncSubscriptions(now: Date = new Date()): Promise<{ moved: number; reminded: number }> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const reminderDays = parseReminderDays(settings.subscriptionReminderDays);
  const rows = await db.select().from(kitchenSubscriptions).where(inArray(kitchenSubscriptions.status, ['active', 'waived', 'grace']));
  let moved = 0;
  let reminded = 0;
  for (const r of rows) {
    const eff = effectiveStatus(r, now, settings.subscriptionGraceDays);
    if (eff !== r.status && (eff === 'grace' || eff === 'expired' || (eff === 'active' && r.status === 'grace'))) {
      await db.update(kitchenSubscriptions).set({ status: eff }).where(eq(kitchenSubscriptions.id, r.id));
      moved++;
      if (eff === 'grace') {
        await notifyOnce(r.sellerId, `Subscription ended — ${settings.subscriptionGraceDays}-day grace period`, 'Your dishes stay visible during grace. Renew now to avoid being hidden.', 'grace', r.id, true);
      } else if (eff === 'expired') {
        await notifyOnce(r.sellerId, 'Subscription expired — your dishes are hidden', 'Renew to bring your kitchen back instantly. Nothing was deleted.', 'expired', r.id, true);
      }
    }
    if (r.endsAt && ['active', 'waived'].includes(eff)) {
      const left = Math.ceil((r.endsAt.getTime() - now.getTime()) / DAY_MS);
      for (const d of reminderDays) {
        if (left <= d && left > 0 && (await notifyOnce(r.sellerId, `Subscription ends in ${d} day${d === 1 ? '' : 's'}`, 'Renew from Seller → Subscription to stay visible without a break.', `remind${d}`, r.id, true))) reminded++;
      }
    }
  }
  return { moved, reminded };
}

async function notifyOnce(userId: number, title: string, body: string, key: string, subId: number, email: boolean): Promise<boolean> {
  const db = await getDb();
  const href = `/seller/subscription?r=${key}-${subId}`; // the href doubles as the de-dup key
  const [exists] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.href, href), isNull(notifications.readAt)));
  const [any] = exists ? [exists] : await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.href, href)));
  if (any) return false;
  await notifyUser(userId, title, body, href, { email, emailKind: 'subscription_reminder' });
  return true;
}

