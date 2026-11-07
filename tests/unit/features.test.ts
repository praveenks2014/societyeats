import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { call, jsonReq, loginAs, webhookReq } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

describe('F7-F11: flag-off features', () => {
  test('everything answers 404 while its flag is off (the default)', async () => {
    const { requestBulk } = await import('@/lib/bulk');
    const { startPurchase } = await import('@/lib/plus');
    const { bookWeek } = await import('@/lib/meal-plans');
    const u = await makeUser(db, 'buyer', { societyId });
    await expect(requestBulk(u.id, { sellerId: 1, description: 'a party of twenty', portions: 20, forDate: '2099-01-01' })).rejects.toMatchObject({ status: 404 });
    await expect(startPurchase(u.id, true)).rejects.toMatchObject({ status: 404 });
    await expect(bookWeek(u.id, 1, new Date())).rejects.toMatchObject({ status: 404 });
    await loginAs(u.id);
    const { GET } = await import('@/app/api/plus/route');
    expect((await call(GET, jsonReq('/x', undefined, { method: 'GET' }))).status).toBe(404);
  });
});

describe('F9: Plus', () => {
  test('purchase is explicit, activation is exactly-once, the discount is capped per month, and expiry is reminded once', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { startPurchase, activatePurchase, activePlus, plusDiscountFor, plusReminders } = await import('@/lib/plus');
    await setPlatformSetting('plusEnabled', 'true');
    const u = await makeUser(db, 'buyer', { societyId });
    await expect(startPurchase(u.id, false)).rejects.toMatchObject({ status: 400 });
    expect(await activePlus(u.id)).toBeNull();
    expect((await plusDiscountFor(u.id, 1000)).discountBps).toBe(0);
    const p = await startPurchase(u.id, true);
    expect(await activatePurchase(p.membershipId, 'pay_1')).not.toBeNull();
    expect(await activatePurchase(p.membershipId, 'pay_1')).toBeNull(); // second caller loses
    expect(await activePlus(u.id)).not.toBeNull();
    const d = await plusDiscountFor(u.id, 1000);
    expect(d.discountBps).toBeGreaterThan(0);
    expect(d.membershipId).toBe(p.membershipId);
    // a cap of zero leaves no discount
    await setPlatformSetting('plusMonthlyDiscountCapPaise', '0');
    expect((await plusDiscountFor(u.id, 1000)).discountBps).toBe(0);
    await setPlatformSetting('plusMonthlyDiscountCapPaise', '5000');
    // reminder: not yet, then once inside the last 3 days
    expect(await plusReminders(new Date())).toBe(0);
    const near = new Date(Date.now() + 28 * 86_400_000);
    expect(await plusReminders(near)).toBe(1);
    expect(await plusReminders(near)).toBe(0);
    await setPlatformSetting('plusEnabled', 'false');
  });
});

describe('F8: featured placement', () => {
  test('visible only inside its dates and society, ended placements vanish, and it is labelled data separate from ranking', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { addPlacement, endPlacement, sponsoredFor } = await import('@/lib/featured');
    await setPlatformSetting('featuredEnabled', 'true');
    const admin = await makeUser(db, 'admin', { societyId });
    const k = await makeLiveKitchen(db, { societyId });
    const other = (await makeSociety(db)).id;
    const pl = await addPlacement(admin.id, { sellerId: k.seller.id, societyId, startsOn: '2026-01-01', endsOn: '2099-01-01' });
    expect((await sponsoredFor(societyId)).map((x) => x.sellerId)).toContain(k.seller.id);
    expect((await sponsoredFor(other)).map((x) => x.sellerId)).not.toContain(k.seller.id);
    expect((await sponsoredFor(societyId, new Date('2025-06-01T00:00:00Z'))).map((x) => x.sellerId)).not.toContain(k.seller.id);
    await endPlacement(admin.id, pl.id);
    expect((await sponsoredFor(societyId)).map((x) => x.sellerId)).not.toContain(k.seller.id);
    await setPlatformSetting('featuredEnabled', 'false');
    expect(await sponsoredFor(societyId)).toEqual([]);
  });
});

describe('F11: campaigns', () => {
  test('a campaign page exists only inside its window', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { createCampaign, activeCampaign } = await import('@/lib/campaigns');
    await setPlatformSetting('campaignsEnabled', 'true');
    const admin = await makeUser(db, 'admin', { societyId });
    const k = await makeLiveKitchen(db, { societyId });
    await createCampaign(admin.id, { slug: 'diwali-feast', title: 'Diwali feast', body: 'Sweets and more', startsOn: '2026-01-01', endsOn: '2099-01-01', sellerIds: [k.seller.id] });
    const c = await activeCampaign('diwali-feast');
    expect(c?.kitchens.map((x) => x.sellerId)).toEqual([k.seller.id]);
    expect(await activeCampaign('diwali-feast', new Date('2025-01-01T00:00:00Z'))).toBeNull();
    expect(await activeCampaign('nope')).toBeNull();
    await setPlatformSetting('campaignsEnabled', 'false');
    expect(await activeCampaign('diwali-feast')).toBeNull();
  });
});

describe('F10: bulk orders', () => {
  test('request → quote → accept makes a scheduled order; the minimum and ownership are enforced', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { requestBulk, quoteBulk, acceptBulk } = await import('@/lib/bulk');
    await setPlatformSetting('bulkOrdersEnabled', 'true');
    await setPlatformSetting('bulkMinPortions', '10');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const u = await makeUser(db, 'buyer', { societyId });
    const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await expect(requestBulk(u.id, { sellerId: k.seller.id, description: 'a party of ten', portions: 5, forDate: date })).rejects.toMatchObject({ status: 400 });
    const r = await requestBulk(u.id, { sellerId: k.seller.id, description: 'a birthday party lunch', portions: 10, forDate: date });
    await expect(acceptBulk(u.id, r.id)).rejects.toMatchObject({ status: 409 }); // no quote yet
    await expect(quoteBulk(k.seller.id, r.id, [{ listingId: k.dish.id, qty: 3 }])).rejects.toMatchObject({ status: 400 });
    const other = await makeLiveKitchen(db, { societyId });
    await expect(quoteBulk(other.seller.id, r.id, [{ listingId: other.dish.id, qty: 10 }])).rejects.toMatchObject({ status: 404 });
    await quoteBulk(k.seller.id, r.id, [{ listingId: k.dish.id, qty: 10 }], 'Happy to cook');
    const o = await acceptBulk(u.id, r.id);
    expect(o.orderId).toBeGreaterThan(0);
    const [row] = await db.select().from(s.bulkRequests).where(eq(s.bulkRequests.id, r.id));
    expect(row.status).toBe('accepted');
    await setPlatformSetting('bulkOrdersEnabled', 'false');
    await setPlatformSetting('bulkMinPortions', '15');
  });
});

describe('F7: meal plans', () => {
  test('a week is one fee payment; every day is its own order; a day can be skipped before the cutoff only', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { createPlan, bookWeek, skipDay } = await import('@/lib/meal-plans');
    const { markOrderPaid } = await import('@/lib/payments');
    await setPlatformSetting('mealPlansEnabled', 'true');
    await setPlatformSetting('preOrderMaxDays', '14');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const u = await makeUser(db, 'buyer', { societyId });
    await createPlan(k.seller.id, { name: 'Tiffin week', days: ['mon', 'tue', 'wed', 'thu', 'fri'], slot: 'lunch', listingIds: [k.dish.id] });
    const [plan] = await db.select().from(s.mealPlans).where(eq(s.mealPlans.sellerId, k.seller.id));
    const start = new Date(Date.now() + 2 * 86_400_000);
    const b = await bookWeek(u.id, plan.id, start);
    expect(b.orderIds.length).toBeGreaterThan(0);
    const pays = await db.select().from(s.payments).where(eq(s.payments.orderId, b.orderIds[0]));
    expect(pays).toHaveLength(1);
    expect(pays[0].amountInPaise).toBe(b.weekFeePaise);
    await markOrderPaid(b.orderIds[0], { razorpayPaymentId: 'pay_week' });
    const orders = await db.select().from(s.orders).where(eq(s.orders.mealPlanSubId, b.subId));
    expect(orders.every((o) => o.status === 'booked')).toBe(true);
    const last = b.orderIds[b.orderIds.length - 1];
    await skipDay(u.id, last);
    const [o] = await db.select().from(s.orders).where(eq(s.orders.id, last));
    expect(o.status).toBe('cancelled_by_buyer');
    const last_time = (x: typeof o) => x.scheduledFor!.getTime();
    await expect(skipDay(u.id, last, new Date(last_time(o) - 3_600_000))).rejects.toBeTruthy();
    await setPlatformSetting('mealPlansEnabled', 'false');
  });
});

describe('F5: meal-plan management and refunds', () => {
  async function bookedWeek() {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { createPlan, bookWeek } = await import('@/lib/meal-plans');
    const { markOrderPaid } = await import('@/lib/payments');
    await setPlatformSetting('mealPlansEnabled', 'true');
    await setPlatformSetting('preOrderMaxDays', '14');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const u = await makeUser(db, 'buyer', { societyId });
    const plan = await createPlan(k.seller.id, { name: 'Tiffin week', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], slot: 'lunch', listingIds: [k.dish.id] });
    const b = await bookWeek(u.id, plan.id, new Date(Date.now() + 3 * 86_400_000));
    await markOrderPaid(b.orderIds[0], { razorpayPaymentId: 'pay_wk' });
    return { k, u, plan, b };
  }

  test('skipping the FIRST day refunds only that day’s share, never the whole week’s payment', async () => {
    const { skipDay } = await import('@/lib/meal-plans');
    const { u, b } = await bookedWeek();
    const [anchor] = await db.select().from(s.orders).where(eq(s.orders.id, b.orderIds[0]));
    await skipDay(u.id, b.orderIds[0]);
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, b.orderIds[0]));
    expect(pay.amountInPaise).toBe(b.weekFeePaise); // one gateway payment for the week
    expect(pay.refundedInPaise).toBe(anchor.onlineChargeInPaise); // …but only the first day's fee goes back
    expect(pay.refundedInPaise).toBeLessThan(b.weekFeePaise);
    const refundRows = await db.select().from(s.refunds).where(eq(s.refunds.orderId, b.orderIds[0]));
    expect(refundRows.reduce((a, r) => a + r.amountInPaise, 0)).toBe(anchor.onlineChargeInPaise);
  });

  test('a kitchen edits and pauses a plan; a paused plan cannot be booked and other kitchens cannot touch it', async () => {
    const { updatePlan, bookWeek, sellerPlans } = await import('@/lib/meal-plans');
    const { k, plan } = await bookedWeek();
    const other = await makeLiveKitchen(db, { societyId });
    await expect(updatePlan(other.seller.id, plan.id, { active: false })).rejects.toMatchObject({ status: 404 });
    await expect(updatePlan(k.seller.id, plan.id, { name: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(updatePlan(k.seller.id, plan.id, { listingIds: [other.dish.id] })).rejects.toMatchObject({ status: 400 });
    await expect(updatePlan(k.seller.id, plan.id, { skipCutoffHours: 0 })).rejects.toMatchObject({ status: 400 });
    await updatePlan(k.seller.id, plan.id, { name: 'Tiffin week (veg)', skipCutoffHours: 24 });
    await updatePlan(k.seller.id, plan.id, { active: false });
    const mine = await sellerPlans(k.seller.id);
    expect(mine[0]).toMatchObject({ name: 'Tiffin week (veg)', active: false, skipCutoffHours: 24 });
    expect(mine[0].dishes[0].price).toBeGreaterThan(0);
    const buyer = await makeUser(db, 'buyer', { societyId });
    await expect(bookWeek(buyer.id, plan.id, new Date(Date.now() + 3 * 86_400_000))).rejects.toMatchObject({ status: 404 });
  });

  test('the plan’s own skip cut-off overrides the platform default', async () => {
    const { updatePlan, skipDay } = await import('@/lib/meal-plans');
    const { k, u, plan, b } = await bookedWeek();
    const [o] = await db.select().from(s.orders).where(eq(s.orders.id, b.orderIds[1] ?? b.orderIds[0]));
    const hoursAway = (o.scheduledFor!.getTime() - Date.now()) / 3_600_000;
    await db.update(s.mealPlans).set({ skipCutoffHours: Math.ceil(hoursAway) + 1 }).where(eq(s.mealPlans.id, plan.id)); // a cut-off longer than the time left
    await expect(skipDay(u.id, o.id)).rejects.toMatchObject({ status: 409 });
    await updatePlan(k.seller.id, plan.id, { skipCutoffHours: null });
    await expect(skipDay(u.id, o.id)).resolves.toBeTruthy();
  });

  test('pause and cancel skip the days still beyond the cut-off, once, and the plan stays on the list only when paused', async () => {
    const { endSub } = await import('@/lib/meal-plans');
    const { u, b } = await bookedWeek();
    const r = await endSub(u.id, b.subId, 'paused');
    expect(r.skipped).toBe(b.orderIds.length);
    const days = await db.select().from(s.orders).where(eq(s.orders.mealPlanSubId, b.subId));
    expect(days.every((d) => d.status.startsWith('cancelled'))).toBe(true);
    const [sub] = await db.select().from(s.mealPlanSubs).where(eq(s.mealPlanSubs.id, b.subId));
    expect(sub.status).toBe('paused');
    await expect(endSub(u.id, b.subId, 'cancelled')).rejects.toMatchObject({ status: 409 });
    const stranger = await makeUser(db, 'buyer', { societyId });
    await expect(endSub(stranger.id, b.subId, 'cancelled')).rejects.toMatchObject({ status: 404 });
  });
});

describe('F5: Plus is activated by the webhook too', () => {
  test('a buyer who pays and closes the tab still gets the month; a wrong amount does nothing', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { startPurchase, activePlus } = await import('@/lib/plus');
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    await setPlatformSetting('plusEnabled', 'true');
    const u = await makeUser(db, 'buyer', { societyId });
    const p = await startPurchase(u.id, true);
    const [m] = await db.select().from(s.plusMemberships).where(eq(s.plusMemberships.id, p.membershipId));
    const evt = (amount: number, id: string) => ({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: m.razorpayOrderId, amount, method: 'upi' } } } });
    const wrong = await call(POST as never, webhookReq(evt(m.pricePaise + m.gstPaise + 1, 'pay_p1'), { eventId: 'evt_plus_wrong' }) as never);
    expect(wrong.status).toBe(200);
    expect(await activePlus(u.id)).toBeNull();
    await call(POST as never, webhookReq(evt(m.pricePaise + m.gstPaise, 'pay_p2'), { eventId: 'evt_plus_ok' }) as never);
    expect(await activePlus(u.id)).not.toBeNull();
    await setPlatformSetting('plusEnabled', 'false');
  });
});

