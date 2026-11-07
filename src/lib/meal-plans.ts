import { and, asc, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { listings, mealPlans, mealPlanSubs, orders, payments } from '@/lib/db/schema';
import { createHomeOrder } from '@/lib/orders/create';
import { performOrderAction } from '@/lib/orders/actions';
import { slotTime } from '@/lib/orders/preorder';
import { createOrderPayment, type CheckoutPayload } from '@/lib/payments';
import { DAY_MS, istParts, istStartOfDay } from '@/lib/time';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

async function assertOn() {
  if (!(await getPlatformSettings()).mealPlansEnabled) throw new ApiError(404, 'Meal plans are not available');
}

export async function createPlan(sellerId: number, input: { name: string; days: string[]; slot: 'breakfast' | 'lunch' | 'dinner'; listingIds: number[] }) {
  await assertOn();
  const name = input.name.trim();
  if (name.length < 3) throw new ApiError(400, 'Give the plan a name');
  if (!input.days.length || input.days.some((d) => !(DAYS as readonly string[]).includes(d))) throw new ApiError(400, 'Choose the days you cook this plan');
  if (!input.listingIds.length) throw new ApiError(400, 'Choose at least one dish');
  const db = await getDb();
  const dishes = await db.select().from(listings).where(eq(listings.sellerId, sellerId));
  if (input.listingIds.some((id) => !dishes.some((d) => d.id === id && d.isActive && d.moderationStatus === 'approved'))) throw new ApiError(400, 'Only your own live dishes can be in a plan');
  const [row] = await db.insert(mealPlans).values({ sellerId, name, days: input.days, slot: input.slot, rotationJson: input.listingIds }).returning();
  return row;
}

/** The dates (IST day starts) a week booking from `start` covers, with the dish each day gets (the rotation cycles through them). */
export function planDays(plan: { days: string[]; rotationJson: number[] }, start: Date): { day: Date; listingId: number }[] {
  const out: { day: Date; listingId: number }[] = [];
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(istStartOfDay(start).getTime() + i * DAY_MS);
    if (plan.days.includes(DAYS[istParts(day).weekday])) out.push({ day, listingId: plan.rotationJson[n++ % plan.rotationJson.length] });
  }
  return out;
}

/**
 * Book a week of a plan. Each day is an ordinary scheduled order (same pay-at-the-door lifecycle); the platform fee for the whole week
 * is charged ONCE at booking, as one payment attached to the first day. Food is still paid to the kitchen each day.
 */
export async function bookWeek(buyerId: number, planId: number, start: Date): Promise<{ subId: number; orderIds: number[]; payment: CheckoutPayload; weekFeePaise: number }> {
  await assertOn();
  const db = await getDb();
  const [plan] = await db.select().from(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.active, true)));
  if (!plan) throw new ApiError(404, 'Plan not found');
  const days = planDays(plan, start);
  if (!days.length) throw new ApiError(400, 'That week has no cooking days');
  const [sub] = await db.insert(mealPlanSubs).values({ planId, buyerId, weekStart: istStartOfDay(start).toISOString().slice(0, 10) }).returning();
  const orderIds: number[] = [];
  let total = 0;
  try {
    for (const d of days) {
      const r = await createHomeOrder({ buyerId, sellerId: plan.sellerId, items: [{ id: d.listingId, qty: 1 }], fulfillmentType: 'self_pickup', scheduledFor: slotTime(d.day, plan.slot as 'lunch'), mealPlanSubId: sub.id });
      orderIds.push(r.orderId);
      total += r.quote.onlineChargePaise;
    }
  } catch (e) {
    for (const id of orderIds) await performOrderAction(id, { action: 'admin_cancel', actor: 'system', actorId: null, reason: 'Meal plan booking failed' } as never).catch(() => {});
    await db.update(mealPlanSubs).set({ status: 'cancelled' }).where(eq(mealPlanSubs.id, sub.id));
    throw e;
  }
  await db.update(mealPlanSubs).set({ anchorOrderId: orderIds[0] }).where(eq(mealPlanSubs.id, sub.id));
  const payment = await createOrderPayment(orderIds[0], total, 'order_fee');
  return { subId: sub.id, orderIds, payment, weekFeePaise: total };
}

/** When the anchor day's fee is captured, the rest of the week's orders are booked too, each with its own share of the shared payment (so refunds stay per day). */
export async function onAnchorPaid(anchorOrderId: number, paymentId: string, markPaid: (id: number, info: { razorpayPaymentId: string; method: string }) => Promise<unknown>) {
  const db = await getDb();
  const [anchor] = await db.select().from(orders).where(eq(orders.id, anchorOrderId));
  if (!anchor?.mealPlanSubId) return;
  const [sub] = await db.select().from(mealPlanSubs).where(eq(mealPlanSubs.id, anchor.mealPlanSubId));
  if (!sub || sub.anchorOrderId !== anchorOrderId) return;
  const sibs = await db.select().from(orders).where(and(eq(orders.mealPlanSubId, sub.id), eq(orders.status, 'fee_pending')));
  for (const o of sibs) {
    if (o.id === anchorOrderId) continue;
    await db.insert(payments).values({ orderId: o.id, razorpayPaymentId: paymentId, status: 'captured', method: 'plan_bundle', amountInPaise: o.onlineChargeInPaise, kind: 'order_fee', capturedAt: new Date() });
    await markPaid(o.id, { razorpayPaymentId: paymentId, method: 'plan_bundle' });
  }
}

/** Skip one day of a booked week, up to `mealPlanSkipCutoffHours` before its slot. Before the kitchen accepts, that day's fee is refunded. */
export async function skipDay(buyerId: number, orderId: number, now: Date = new Date()) {
  await assertOn();
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [o] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)));
  if (!o || !o.mealPlanSubId || !o.scheduledFor) throw new ApiError(404, 'Meal plan day not found');
  if (o.scheduledFor.getTime() - now.getTime() < settings.mealPlanSkipCutoffHours * 3_600_000) throw new ApiError(409, `A day can be skipped up to ${settings.mealPlanSkipCutoffHours} hours before it`);
  return performOrderAction(orderId, { action: 'buyer_cancel', actor: 'buyer', actorId: buyerId, reason: 'Skipped a meal plan day' } as never);
}

export async function mySubs(buyerId: number) {
  const db = await getDb();
  const subs = await db.select().from(mealPlanSubs).where(eq(mealPlanSubs.buyerId, buyerId)).orderBy(asc(mealPlanSubs.id));
  const out = [];
  for (const s of subs) out.push({ ...s, days: await db.select({ id: orders.id, status: orders.status, scheduledFor: orders.scheduledFor }).from(orders).where(eq(orders.mealPlanSubId, s.id)).orderBy(asc(orders.scheduledFor)) });
  return out;
}
