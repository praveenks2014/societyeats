import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, jsonReq, loginAs, webhookReq } from '../helpers/http';
import { getTestPlan, makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;

beforeAll(async () => {
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_value';
  process.env.MOCK_MODE = 'true';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

async function paidOrder(over: { qty?: number; stock?: number; mode?: 'upi_now' | 'pay_at_pickup'; price?: number } = {}) {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const { markOrderPaid } = await import('@/lib/payments');
  const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: over.stock ?? 10, price: over.price ?? 10000 });
  const buyer = await makeUser(db, 'buyer', { societyId });
  const r = await createHomeOrder({ buyerId: buyer.id, sellerId: seller.id, items: [{ id: dish.id, qty: over.qty ?? 2 }], fulfillmentType: 'self_pickup' });
  await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
  return { seller, buyer, dish, orderId: r.orderId };
}
const order = async (id: number) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0];
const dishRow = async (id: number) => (await db.select().from(s.listings).where(eq(s.listings.id, id)))[0];

describe('expiry and stock', () => {
  test('unpaid orders expire after the configured time, releasing stock and referral credit', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { expireUnpaidOrders } = await import('@/lib/orders/lifecycle');
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 5 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const referred = await makeUser(db, 'buyer', { societyId });
    const [o0] = await db.insert(s.orders).values({ buyerId: referred.id, type: 'home_delivery', sellerId: seller.id, subtotalInPaise: 1, totalInPaise: 1, otpCode: '1111' }).returning();
    await db.insert(s.referralCredits).values({ buyerId: buyer.id, referredUserId: referred.id, referredOrderId: o0.id, amountInPaise: 500 });
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: seller.id, items: [{ id: dish.id, qty: 3 }], fulfillmentType: 'self_pickup', useCredit: true });
    expect((await dishRow(dish.id)).availableQty).toBe(2);
    const reserved = await db.select().from(s.referralCredits).where(eq(s.referralCredits.buyerId, buyer.id));
    expect(reserved.some((c) => c.status === 'reserved' && c.amountInPaise === 500)).toBe(true);

    expect(await expireUnpaidOrders(new Date())).toBe(0); // not yet
    expect(await expireUnpaidOrders(new Date(Date.now() + 16 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await order(r.orderId)).status).toBe('expired');
    expect((await dishRow(dish.id)).availableQty).toBe(5);
    const after = await db.select().from(s.referralCredits).where(eq(s.referralCredits.buyerId, buyer.id));
    expect(after.every((c) => c.status === 'available')).toBe(true);
    expect(await expireUnpaidOrders(new Date(Date.now() + 60 * 60_000))).toBe(0); // idempotent: stock isn't released twice
    expect((await dishRow(dish.id)).availableQty).toBe(5);
  });

  test('a payment captured AFTER expiry is refunded automatically', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { expireUnpaidOrders } = await import('@/lib/orders/lifecycle');
    const { markOrderPaid } = await import('@/lib/payments');
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 5 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: seller.id, items: [{ id: dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    await expireUnpaidOrders(new Date(Date.now() + 20 * 60_000));
    const res = await markOrderPaid(r.orderId, { razorpayPaymentId: 'pay_late' });
    expect(res.won).toBe(false);
    expect((await order(r.orderId)).status).toBe('expired');
    const refs = await db.select().from(s.refunds).where(eq(s.refunds.orderId, r.orderId));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ amountInPaise: 1000, status: 'processed' });
  });
});

describe('webhook', () => {
  async function pending() {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 10 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: seller.id, items: [{ id: dish.id, qty: 2 }], fulfillmentType: 'self_pickup' });
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, r.orderId));
    return { orderId: r.orderId, rzpOrderId: pay.razorpayOrderId! };
  }
  const post = async (req: ReturnType<typeof webhookReq>) => {
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    return call(POST as never, req as never);
  };
  const captured = (rzpOrderId: string, amount: number, id = 'pay_w1') => ({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: rzpOrderId, amount, method: 'upi' } } } });

  test('rejects bad signatures', async () => {
    const { rzpOrderId } = await pending();
    expect((await post(webhookReq(captured(rzpOrderId, 2000), { badSig: true }))).status).toBe(400);
  });

  test('dedupes on event id; captured amount must match; late payment.failed never downgrades', async () => {
    const { orderId, rzpOrderId } = await pending();
    // wrong amount → ignored, order stays placed
    const bad = await post(webhookReq(captured(rzpOrderId, 1), { eventId: 'evt_bad' }));
    expect(bad.json.outcome).toBe('amount_mismatch');
    expect((await order(orderId)).status).toBe('fee_pending');
    // right amount → paid
    const good = await post(webhookReq(captured(rzpOrderId, 2000), { eventId: 'evt_1' }));
    expect(good.json.outcome).toBe('order_paid');
    expect((await order(orderId)).status).toBe('booked');
    // same event again → duplicate, no side effects
    const dup = await post(webhookReq(captured(rzpOrderId, 2000), { eventId: 'evt_1' }));
    expect(dup.json.duplicate).toBe(true);
    // different event id, same payment → already paid (no second notification)
    const again = await post(webhookReq(captured(rzpOrderId, 2000), { eventId: 'evt_2' }));
    expect(again.json.outcome).toBe('order_already_paid');
    // a late failure must not overwrite the capture
    await post(webhookReq({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_w0', order_id: rzpOrderId, amount: 2000 } } } }, { eventId: 'evt_3' }));
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, orderId));
    expect(pay.status).toBe('captured');
    expect((await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, 'evt_1'))).length).toBe(1);
  });

  test('refund.processed / refund.failed update the refunds table; a failed refund frees the amount', async () => {
    const { orderId, rzpOrderId } = await pending();
    await post(webhookReq(captured(rzpOrderId, 2000, 'pay_r1'), { eventId: 'evt_r0' }));
    const { refundOrderPayment } = await import('@/lib/payments/refunds');
    const res = await refundOrderPayment({ orderId, amountInPaise: 500, reason: 't', initiatedBy: 'admin:1' });
    const [row] = await db.select().from(s.refunds).where(eq(s.refunds.id, res.refundId));
    const ev = (type: string) => ({ event: type, payload: { refund: { entity: { id: row.razorpayRefundId, payment_id: 'pay_r1' } } } });
    await post(webhookReq(ev('refund.processed'), { eventId: 'evt_r1' }));
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, row.id)))[0].status).toBe('processed');
    await post(webhookReq(ev('refund.failed'), { eventId: 'evt_r2' }));
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, row.id)))[0].status).toBe('failed');
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, orderId));
    expect(pay.refundedInPaise).toBe(0);
  });

  test('subscription payments are handled by the same webhook', async () => {
    const { startSubscriptionPayment } = await import('@/lib/subscriptions/service');
    const { seedSubscriptionPlans } = await import('@/lib/subscriptions/plans');
    await seedSubscriptionPlans(db);
    const plan = await getTestPlan(db);
    const k = await makeUser(db, 'seller', { societyId });
    await db.insert(s.sellerProfiles).values({ userId: k.id, kitchenName: 'K' });
    const co = await startSubscriptionPayment(k.id, plan.id);
    const [sub] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, co.subscriptionId));
    const r = await post(webhookReq({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_sub1', order_id: sub.razorpayOrderId, amount: 29900 } } } }, { eventId: 'evt_s1' }));
    expect(r.json.outcome).toBe('subscription_paid');
    const [after] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, sub.id));
    expect(after.status).toBe('active');
    expect(after.endsAt!.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
  });
});

describe('platform-fee refund service', () => {
  test('partial then remainder; cannot exceed the captured amount; concurrent full refunds → one succeeds', async () => {
    const { refundOrderPayment } = await import('@/lib/payments/refunds');
    const { orderId } = await paidOrder({ qty: 2, price: 10000 }); // fee ₹20
    await expect(refundOrderPayment({ orderId, amountInPaise: 2500, reason: 't', initiatedBy: 'system' })).rejects.toMatchObject({ status: 409 });
    await expect(refundOrderPayment({ orderId, amountInPaise: 0, reason: 't', initiatedBy: 'system' })).rejects.toMatchObject({ status: 400 });
    await refundOrderPayment({ orderId, amountInPaise: 500, reason: 'partial', initiatedBy: 'admin:1' });
    let [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, orderId));
    expect(pay).toMatchObject({ refundedInPaise: 500, status: 'captured' });
    const results = await Promise.allSettled([refundOrderPayment({ orderId, reason: 'rest', initiatedBy: 'system' }), refundOrderPayment({ orderId, reason: 'rest', initiatedBy: 'system' })]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, orderId));
    expect(pay).toMatchObject({ refundedInPaise: 2000, status: 'refunded' });
    const total = (await db.select().from(s.refunds).where(and(eq(s.refunds.orderId, orderId), eq(s.refunds.status, 'processed')))).reduce((a, r) => a + r.amountInPaise, 0);
    expect(total).toBe(2000);
  });

  test('a gateway failure rolls the reservation back and marks the refund failed', async () => {
    vi.resetModules();
    vi.doMock('@/lib/payments/razorpay', async (orig) => ({ ...(await orig<typeof import('@/lib/payments/razorpay')>()), createRazorpayRefund: vi.fn(async () => { throw new Error('gateway down'); }) }));
    const { orderId } = await paidOrder({ qty: 1 });
    const { refundOrderPayment } = await import('@/lib/payments/refunds');
    await expect(refundOrderPayment({ orderId, reason: 't', initiatedBy: 'system' })).rejects.toMatchObject({ status: 502 });
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, orderId));
    expect(pay.refundedInPaise).toBe(0);
    expect((await db.select().from(s.refunds).where(eq(s.refunds.orderId, orderId)))[0].status).toBe('failed');
    vi.doUnmock('@/lib/payments/razorpay');
    vi.resetModules();
  });

  test('upheld complaint: admin refunds the platform fee via Razorpay and the FOOD refund becomes a kitchen refund due', async () => {
    const { PATCH } = await import('@/app/api/admin/complaints/[id]/route');
    const admin = await makeUser(db, 'admin');
    process.env.ADMIN_EMAILS = admin.email!;
    const { seller, buyer, orderId } = await paidOrder({ qty: 2 });
    await db.update(s.orders).set({ status: 'completed', foodPaymentStatus: 'confirmed', completedAt: new Date() }).where(eq(s.orders.id, orderId));
    const [c] = await db.insert(s.complaints).values({ orderId, buyerId: buyer.id, sellerId: seller.id, category: 'quality', description: 'cold' }).returning();
    await loginAs(admin.id);
    const r = await call(PATCH, jsonReq(`/api/admin/complaints/${c.id}`, { outcome: 'partial_refund', platformFeeRefundInPaise: 1000, foodRefundDueInPaise: 5000, note: 'half' }, { method: 'PATCH' }), { id: String(c.id) });
    expect(r.status).toBe(200);
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, orderId));
    expect(pay.refundedInPaise).toBe(1000);
    const due = await db.select().from(s.kitchenRefundsDue).where(eq(s.kitchenRefundsDue.orderId, orderId));
    expect(due[0]).toMatchObject({ amountInPaise: 5000, reason: 'complaint', status: 'due' });
    // more than the remaining platform fee is rejected
    const [c2] = await db.insert(s.complaints).values({ orderId, buyerId: buyer.id, sellerId: seller.id, category: 'quality', description: 'again' }).returning();
    const bad = await call(PATCH, jsonReq(`/api/admin/complaints/${c2.id}`, { outcome: 'partial_refund', platformFeeRefundInPaise: 99999 }, { method: 'PATCH' }), { id: String(c2.id) });
    expect(bad.status).toBe(400);
  });
});

describe('referral credit: reserve → consume / release, partial use splits rows', () => {
  test('partial use keeps the remainder available; consume on payment; release on cancel', async () => {
    const { reserveCredit, consumeReservedCredit, releaseCredit, availableCreditPaise } = await import('@/lib/referrals');
    const buyer = await makeUser(db, 'buyer', { societyId });
    const friend = await makeUser(db, 'buyer', { societyId });
    const [o0] = await db.insert(s.orders).values({ buyerId: friend.id, type: 'home_delivery', subtotalInPaise: 1, totalInPaise: 1, otpCode: '1' }).returning();
    await db.insert(s.referralCredits).values({ buyerId: buyer.id, referredUserId: friend.id, referredOrderId: o0.id, amountInPaise: 3000 });
    const [o1] = await db.insert(s.orders).values({ buyerId: buyer.id, type: 'home_delivery', subtotalInPaise: 1, totalInPaise: 1, otpCode: '2' }).returning();
    expect(await availableCreditPaise(buyer.id)).toBe(3000);
    expect(await reserveCredit(db, buyer.id, o1.id, 1200)).toBe(1200);
    expect(await availableCreditPaise(buyer.id)).toBe(1800); // remainder not discarded
    await consumeReservedCredit(db, o1.id);
    expect(await availableCreditPaise(buyer.id)).toBe(1800);
    expect(await releaseCredit(db, o1.id)).toBe(1200);
    expect(await availableCreditPaise(buyer.id)).toBe(3000);
  });
});
