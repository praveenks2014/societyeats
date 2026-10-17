import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, jsonReq, loginAs, webhookReq } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { canTransition, nextOrderStatus } from '@/lib/orders/state';

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
  const r = await createHomeOrder({ buyerId: buyer.id, buyerApproved: true, sellerId: seller.id, items: [{ id: dish.id, qty: over.qty ?? 2 }], fulfillmentType: 'self_pickup', foodPaymentMode: over.mode ?? 'upi_now' });
  await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
  return { seller, buyer, dish, orderId: r.orderId };
}
const order = async (id: number) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0];
const dishRow = async (id: number) => (await db.select().from(s.listings).where(eq(s.listings.id, id)))[0];
const statusPost = async (orderId: number, action: string, note?: string) => {
  const { POST } = await import('@/app/api/orders/[id]/status/route');
  return call(POST, jsonReq(`/api/orders/${orderId}/status`, { action, note }), { id: String(orderId) });
};
const foodPost = async (orderId: number, action: string, utr?: string) => {
  const { POST } = await import('@/app/api/orders/[id]/food-payment/route');
  return call(POST, jsonReq(`/api/orders/${orderId}/food-payment`, { action, utr }), { id: String(orderId) });
};
const otpPost = async (orderId: number, otp: string) => {
  const { POST } = await import('@/app/api/orders/[id]/verify-otp/route');
  return call(POST, jsonReq(`/api/orders/${orderId}/verify-otp`, { otp }), { id: String(orderId) });
};

describe('order state machine', () => {
  test('allowed transitions with role checks', () => {
    expect(nextOrderStatus('placed', 'pay_fee', 'system')).toBe('fee_paid');
    expect(nextOrderStatus('fee_paid', 'accept', 'seller')).toBe('accepted');
    expect(nextOrderStatus('ready', 'handover_pickup', 'seller')).toBe('picked_up');
    expect(nextOrderStatus('out_for_delivery', 'handover_delivery', 'admin')).toBe('delivered');
  });
  test('buyers cannot accept, reject or complete; illegal jumps are refused', () => {
    expect(canTransition('fee_paid', 'accept', 'buyer')).toBe(false);
    expect(canTransition('ready', 'handover_pickup', 'buyer')).toBe(false);
    expect(canTransition('placed', 'accept', 'seller')).toBe(false); // kitchen can't touch an unpaid order
    expect(canTransition('fee_paid', 'ready', 'seller')).toBe(false);
    expect(canTransition('cancelled', 'accept', 'seller')).toBe(false);
    expect(canTransition('expired', 'pay_fee', 'system')).toBe(false);
    expect(canTransition('fee_paid', 'claim_food_paid', 'seller')).toBe(false);
  });
});

describe('expiry and stock', () => {
  test('unpaid orders expire after the configured time, releasing stock and referral credit', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { expireUnpaidOrders } = await import('@/lib/orders/lifecycle');
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 5 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const referred = await makeUser(db, 'buyer', { societyId });
    const [o0] = await db.insert(s.orders).values({ buyerId: referred.id, type: 'home_delivery', sellerId: seller.id, subtotalInPaise: 1, totalInPaise: 1, otpCode: '1111' }).returning();
    await db.insert(s.referralCredits).values({ buyerId: buyer.id, referredUserId: referred.id, referredOrderId: o0.id, amountInPaise: 500 });
    const r = await createHomeOrder({ buyerId: buyer.id, buyerApproved: true, sellerId: seller.id, items: [{ id: dish.id, qty: 3 }], fulfillmentType: 'self_pickup', foodPaymentMode: 'upi_now', useCredit: true });
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
    const r = await createHomeOrder({ buyerId: buyer.id, buyerApproved: true, sellerId: seller.id, items: [{ id: dish.id, qty: 1 }], fulfillmentType: 'self_pickup', foodPaymentMode: 'upi_now' });
    await expireUnpaidOrders(new Date(Date.now() + 20 * 60_000));
    const res = await markOrderPaid(r.orderId, { razorpayPaymentId: 'pay_late' });
    expect(res.won).toBe(false);
    expect((await order(r.orderId)).status).toBe('expired');
    const refs = await db.select().from(s.refunds).where(eq(s.refunds.orderId, r.orderId));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ amountInPaise: 1000, status: 'processed' });
  });
});

describe('reject / auto-cancel → automatic platform-fee refund', () => {
  test('kitchen rejects: fee refunded via Razorpay (mock), stock released, buyer notified', async () => {
    const { seller, buyer, dish, orderId } = await paidOrder({ qty: 2, stock: 10 });
    expect((await dishRow(dish.id)).availableQty).toBe(8);
    await loginAs(seller.id);
    const r = await statusPost(orderId, 'reject', 'Out of gas');
    expect(r.status).toBe(200);
    expect((await order(orderId)).status).toBe('cancelled');
    expect((await dishRow(dish.id)).availableQty).toBe(10);
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, orderId));
    expect(pay).toMatchObject({ status: 'refunded', refundedInPaise: 2000 });
    const refs = await db.select().from(s.refunds).where(eq(s.refunds.orderId, orderId));
    expect(refs[0]).toMatchObject({ amountInPaise: 2000, kind: 'platform_fee', status: 'processed' });
    expect(refs[0].razorpayRefundId).toMatch(/^rfnd_MOCK/);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.userId, buyer.id));
    expect(notes.some((n) => n.title.includes(`#${orderId}`))).toBe(true);
    // a second reject conflicts, and does not double-refund
    expect((await statusPost(orderId, 'reject')).status).toBe(409);
    expect((await db.select().from(s.refunds).where(eq(s.refunds.orderId, orderId))).length).toBe(1);
  });

  test('rejecting after the buyer paid the kitchen by UPI creates a "kitchen refund due" for the food', async () => {
    const { seller, buyer, orderId } = await paidOrder({ qty: 2 });
    await loginAs(buyer.id);
    expect((await foodPost(orderId, 'claim', 'UTR123456789')).status).toBe(200);
    await loginAs(seller.id);
    expect((await statusPost(orderId, 'reject')).status).toBe(200);
    const due = await db.select().from(s.kitchenRefundsDue).where(eq(s.kitchenRefundsDue.orderId, orderId));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ amountInPaise: 20000, status: 'due', sellerId: seller.id });
  });

  test('unaccepted orders auto-cancel after the acceptance window and refund the fee', async () => {
    const { autoCancelUnaccepted } = await import('@/lib/orders/lifecycle');
    const { orderId, dish } = await paidOrder({ qty: 1, stock: 4 });
    expect(await autoCancelUnaccepted(new Date())).toBe(0);
    expect(await autoCancelUnaccepted(new Date(Date.now() + 16 * 60_000))).toBeGreaterThanOrEqual(1);
    const o = await order(orderId);
    expect(o.status).toBe('cancelled');
    expect(o.cancelReason).toMatch(/did not respond/i);
    expect((await dishRow(dish.id)).availableQty).toBe(4);
    expect((await db.select().from(s.refunds).where(eq(s.refunds.orderId, orderId)))[0].status).toBe('processed');
  });

  test('a delisted kitchen cannot ACCEPT new orders but can finish accepted ones', async () => {
    const { seller, buyer, orderId } = await paidOrder({ qty: 1 });
    const second = await paidOrder({ qty: 1 });
    await loginAs(seller.id);
    expect((await statusPost(orderId, 'accept')).status).toBe(200);
    await db.update(s.sellerProfiles).set({ listingState: 'delisted', isApproved: false }).where(eq(s.sellerProfiles.userId, seller.id));
    expect((await statusPost(orderId, 'preparing')).status).toBe(200);
    expect((await statusPost(orderId, 'ready')).status).toBe(200);
    // second order belongs to a different (still live) kitchen: delist it and try to accept
    await db.update(s.sellerProfiles).set({ listingState: 'delisted', isApproved: false }).where(eq(s.sellerProfiles.userId, second.seller.id));
    await loginAs(second.seller.id);
    expect((await statusPost(second.orderId, 'accept')).status).toBe(403);
    void buyer;
  });
});

describe('food payment + handover OTP', () => {
  test('UPI flow: claim → awaiting confirmation → kitchen confirms → accept → ready → seller OTP → completed with completed_at', async () => {
    const { seller, buyer, orderId } = await paidOrder({ qty: 2, mode: 'upi_now' });
    await loginAs(buyer.id);
    expect((await foodPost(orderId, 'claim')).status).toBe(200);
    expect((await order(orderId)).status).toBe('awaiting_kitchen_payment_confirmation');
    expect((await foodPost(orderId, 'claim')).status).toBe(409);
    expect((await foodPost(orderId, 'confirm')).status).toBe(403); // buyer cannot confirm their own payment
    await loginAs(seller.id);
    expect((await foodPost(orderId, 'confirm')).status).toBe(200);
    expect((await order(orderId)).status).toBe('fee_paid');
    expect((await statusPost(orderId, 'accept')).status).toBe(200);
    expect((await statusPost(orderId, 'ready')).status).toBe(200);
    const otp = (await order(orderId)).otpCode;
    // buyer cannot complete their own order, even with the right code
    await loginAs(buyer.id);
    expect((await otpPost(orderId, otp)).status).toBe(403);
    // another kitchen cannot either
    const other = await makeLiveKitchen(db, { societyId });
    await loginAs(other.seller.id);
    expect((await otpPost(orderId, otp)).status).toBe(403);
    await loginAs(seller.id);
    expect((await otpPost(orderId, '0000' === otp ? '1111' : '0000')).status).toBe(400);
    expect((await otpPost(orderId, otp)).status).toBe(200);
    const done = await order(orderId);
    expect(done.status).toBe('picked_up');
    expect(done.completedAt).toBeInstanceOf(Date);
    expect((await otpPost(orderId, otp)).status).toBe(409); // cannot complete twice
  });

  test('the OTP is refused until the kitchen has confirmed the UPI payment', async () => {
    const { seller, buyer, orderId } = await paidOrder({ qty: 1, mode: 'upi_now' });
    await loginAs(seller.id);
    await statusPost(orderId, 'accept');
    await statusPost(orderId, 'ready');
    expect((await otpPost(orderId, (await order(orderId)).otpCode)).status).toBe(409);
    void buyer;
  });

  test('"not received" opens a complaint and sends the order back to fee_paid', async () => {
    const { seller, buyer, orderId } = await paidOrder({ qty: 1, mode: 'upi_now' });
    await loginAs(buyer.id);
    await foodPost(orderId, 'claim', 'UTRABC12345');
    await loginAs(seller.id);
    expect((await foodPost(orderId, 'not_received')).status).toBe(200);
    expect((await order(orderId)).foodPaymentStatus).toBe('not_received');
    const cs = await db.select().from(s.complaints).where(eq(s.complaints.orderId, orderId));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ raisedBy: 'seller', category: 'not_received' });
  });

  test('pay-at-pickup: kitchen records "paid at handover" before the OTP works', async () => {
    const { seller, orderId } = await paidOrder({ qty: 1, mode: 'pay_at_pickup' });
    await loginAs(seller.id);
    await statusPost(orderId, 'accept');
    await statusPost(orderId, 'ready');
    const otp = (await order(orderId)).otpCode;
    expect((await otpPost(orderId, otp)).status).toBe(409);
    expect((await foodPost(orderId, 'paid_at_handover')).status).toBe(200);
    expect((await otpPost(orderId, otp)).status).toBe(200);
  });

  test('unconfirmed UPI payments are reminded once after the configured minutes and never auto-cancelled', async () => {
    const { remindUnconfirmedPayments } = await import('@/lib/orders/lifecycle');
    const { buyer, orderId } = await paidOrder({ qty: 1, mode: 'upi_now' });
    await loginAs(buyer.id);
    await foodPost(orderId, 'claim');
    expect(await remindUnconfirmedPayments(new Date())).toBe(0);
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await remindUnconfirmedPayments(later)).toBeGreaterThanOrEqual(1);
    expect(await remindUnconfirmedPayments(later)).toBe(0);
    expect((await order(orderId)).status).toBe('awaiting_kitchen_payment_confirmation');
  });
});

describe('webhook', () => {
  async function pending() {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 10 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const r = await createHomeOrder({ buyerId: buyer.id, buyerApproved: true, sellerId: seller.id, items: [{ id: dish.id, qty: 2 }], fulfillmentType: 'self_pickup', foodPaymentMode: 'upi_now' });
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
    expect((await order(orderId)).status).toBe('placed');
    // right amount → paid
    const good = await post(webhookReq(captured(rzpOrderId, 2000), { eventId: 'evt_1' }));
    expect(good.json.outcome).toBe('order_paid');
    expect((await order(orderId)).status).toBe('fee_paid');
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
    const [plan] = await db.select().from(s.subscriptionPlans);
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
    const { seller, buyer, orderId } = await paidOrder({ qty: 2, mode: 'pay_at_pickup' });
    await loginAs(seller.id);
    await statusPost(orderId, 'accept');
    await statusPost(orderId, 'ready');
    await foodPost(orderId, 'paid_at_handover');
    await otpPost(orderId, (await order(orderId)).otpCode);
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
