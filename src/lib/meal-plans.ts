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

async function skipCutoffFor(subId: number, platformDefault: number): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ c: mealPlans.skipCutoffHours }).from(mealPlanSubs).innerJoin(mealPlans, eq(mealPlans.id, mealPlanSubs.planId)).where(eq(mealPlanSubs.id, subId));
  return row?.c ?? platformDefault;
}

/** Skip one day of a booked week, up to `mealPlanSkipCutoffHours` before its slot. Before the kitchen accepts, that day's fee is refunded. */
export async function skipDay(buyerId: number, orderId: number, now: Date = new Date()) {
  await assertOn();
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [o] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)));
  if (!o || !o.mealPlanSubId || !o.scheduledFor) throw new ApiError(404, 'Meal plan day not found');
  const cutoff = await skipCutoffFor(o.mealPlanSubId, settings.mealPlanSkipCutoffHours);
  if (o.scheduledFor.getTime() - now.getTime() < cutoff * 3_600_000) throw new ApiError(409, `A day can be skipped up to ${cutoff} hours before it`);
  return performOrderAction(orderId, { action: 'buyer_cancel', actor: 'buyer', actorId: buyerId, reason: 'Skipped a meal plan day' } as never);
}

export async function mySubs(buyerId: number) {
  const db = await getDb();
  const subs = await db.select().from(mealPlanSubs).where(eq(mealPlanSubs.buyerId, buyerId)).orderBy(asc(mealPlanSubs.id));
  const out = [];
  for (const s of subs) out.push({ ...s, days: await db.select({ id: orders.id, status: orders.status, scheduledFor: orders.scheduledFor }).from(orders).where(eq(orders.mealPlanSubId, s.id)).orderBy(asc(orders.scheduledFor)) });
  return out;
}

const ALLOWED_SLOTS = ['breakfast', 'lunch', 'dinner'] as const;

/** The kitchen's own plans (paused ones too) with each day's food price, so the page can show "₹X a day". */
export async function sellerPlans(sellerId: number) {
  const db = await getDb();
  const plans = await db.select().from(mealPlans).where(eq(mealPlans.sellerId, sellerId)).orderBy(asc(mealPlans.id));
  const dishes = await db.select({ id: listings.id, title: listings.title, price: listings.priceInPaise }).from(listings).where(eq(listings.sellerId, sellerId));
  return plans.map((p) => ({ ...p, dishes: p.rotationJson.map((id) => dishes.find((d) => d.id === id)).filter(Boolean) as { id: number; title: string; price: number }[] }));
}

/** Edit or pause a plan. Weeks already booked are untouched (they are ordinary orders); the change applies to the next booking. */
export async function updatePlan(sellerId: number, planId: number, patch: { name?: string; days?: string[]; slot?: string; listingIds?: number[]; skipCutoffHours?: number | null; active?: boolean }) {
  await assertOn();
  const db = await getDb();
  const [plan] = await db.select().from(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.sellerId, sellerId)));
  if (!plan) throw new ApiError(404, 'Plan not found');
  const set: Partial<typeof mealPlans.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (patch.name.trim().length < 3) throw new ApiError(400, 'Give the plan a name');
    set.name = patch.name.trim();
  }
  if (patch.days !== undefined) {
    if (!patch.days.length || patch.days.some((d) => !(DAYS as readonly string[]).includes(d))) throw new ApiError(400, 'Choose the days you cook this plan');
    set.days = patch.days;
  }
  if (patch.slot !== undefined) {
    if (!(ALLOWED_SLOTS as readonly string[]).includes(patch.slot)) throw new ApiError(400, 'Choose breakfast, lunch or dinner');
    set.slot = patch.slot;
  }
  if (patch.listingIds !== undefined) {
    const dishes = await db.select().from(listings).where(eq(listings.sellerId, sellerId));
    if (!patch.listingIds.length || patch.listingIds.some((id) => !dishes.some((d) => d.id === id && d.isActive && d.moderationStatus === 'approved'))) throw new ApiError(400, 'Only your own live dishes can be in a plan');
    set.rotationJson = patch.listingIds;
  }
  if (patch.skipCutoffHours !== undefined) {
    if (patch.skipCutoffHours !== null && (!Number.isInteger(patch.skipCutoffHours) || patch.skipCutoffHours < 1 || patch.skipCutoffHours > 72)) throw new ApiError(400, 'The skip cut-off must be between 1 and 72 hours');
    set.skipCutoffHours = patch.skipCutoffHours;
  }
  if (patch.active !== undefined) set.active = patch.active;
  if (!Object.keys(set).length) return plan;
  const [row] = await db.update(mealPlans).set(set).where(eq(mealPlans.id, planId)).returning();
  return row;
}

/**
 * Pause or cancel the rest of a booked week: every day still beyond the skip cut-off is skipped one by one (each day's own fee share is refunded
 * if the kitchen has not accepted it yet; otherwise it is kept, exactly as for a single skip). Days inside the cut-off stay booked.
 * Weeks are booked explicitly, so "paused" keeps the plan on the buyer's list ready to book again and "cancelled" removes it.
 */
export async function endSub(buyerId: number, subId: number, to: 'paused' | 'cancelled', now: Date = new Date()) {
  await assertOn();
  const db = await getDb();
  const [sub] = await db.select().from(mealPlanSubs).where(and(eq(mealPlanSubs.id, subId), eq(mealPlanSubs.buyerId, buyerId)));
  if (!sub) throw new ApiError(404, 'Meal plan not found');
  if (sub.status !== 'active') throw new ApiError(409, `This plan is already ${sub.status}`);
  const days = await db.select().from(orders).where(eq(orders.mealPlanSubId, subId));
  let skipped = 0;
  let kept = 0;
  for (const o of days) {
    if (!o.scheduledFor || o.scheduledFor <= now || ['cancelled_by_buyer', 'cancelled_by_seller', 'expired', 'completed'].includes(o.status) || o.status.startsWith('cancelled')) continue;
    try {
      await skipDay(buyerId, o.id, now);
      skipped++;
    } catch {
      kept++; // inside the cut-off, or already in progress
    }
  }
  await db.update(mealPlanSubs).set({ status: to }).where(eq(mealPlanSubs.id, subId));
  return { skipped, kept };
}
