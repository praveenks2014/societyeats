import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, checkoutSignature, jsonReq, loginAs, webhookReq } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
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
beforeEach(() => {
  process.env.MOCK_MODE = 'true';
});

async function placeOrder(buyerId: number, sellerId: number, dishId: number, qty = 2, over: Record<string, unknown> = {}) {
  const { createHomeOrder } = await import('@/lib/orders/create');
  return createHomeOrder({ buyerId, buyerApproved: true, sellerId, items: [{ id: dishId, qty }], fulfillmentType: 'self_pickup', foodPaymentMode: 'upi_now', ...over } as never);
}
const getOrder = async (id: number) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0];
const getDish = async (id: number) => (await db.select().from(s.listings).where(eq(s.listings.id, id)))[0];

describe('order creation: money model, reservation, snapshots', () => {
  test('food ₹200 to the kitchen + ₹20 platform fee; stock reserved at creation; fee rates snapshotted', async () => {
    const { seller, dish } = await makeLiveKitchen(db, { societyId, price: 10000, qty: 5 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const r = await placeOrder(buyer.id, seller.id, dish.id, 2);
    expect(r.quote).toMatchObject({ foodTotalPaise: 20000, platformFeePaise: 2000, onlineChargePaise: 2000, grandTotalPaise: 22000 });
    expect(r.payment).toMatchObject({ mode: 'mock', amountInPaise: 2000 });
    const o = await getOrder(r.orderId);
    expect(o).toMatchObject({ status: 'placed', foodTotalInPaise: 20000, onlineChargeInPaise: 2000, feeBpsSnapshot: 1000, stockReserved: true, foodPaymentMode: 'upi_now' });
    expect(o.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await getDish(dish.id)).availableQty).toBe(3);
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, r.orderId));
    expect(pay).toMatchObject({ amountInPaise: 2000, kind: 'order_fee', status: 'created' });
  });

  test('a changed fee % never alters existing orders; the next order snapshots the new rate', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { seller, dish } = await makeLiveKitchen(db, { societyId, price: 10000, qty: 50 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const first = await placeOrder(buyer.id, seller.id, dish.id, 2);
    await setPlatformSetting('buyerPlatformFeeBps', '1200');
    const second = await placeOrder(buyer.id, seller.id, dish.id, 2);
    await setPlatformSetting('buyerPlatformFeeBps', '1000');
    expect((await getOrder(first.orderId)).platformFeeInPaise).toBe(2000);
    expect((await getOrder(first.orderId)).feeBpsSnapshot).toBe(1000);
    expect((await getOrder(second.orderId)).platformFeeInPaise).toBe(2400);
    expect((await getOrder(second.orderId)).feeBpsSnapshot).toBe(1200);
  });

  test('cannot oversell: the second buyer of the last portions is refused', async () => {
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 3 });
    const a = await makeUser(db, 'buyer', { societyId });
    const b = await makeUser(db, 'buyer', { societyId });
    await placeOrder(a.id, seller.id, dish.id, 2);
    await expect(placeOrder(b.id, seller.id, dish.id, 2)).rejects.toMatchObject({ status: 409 });
    expect((await getDish(dish.id)).availableQty).toBe(1);
    // concurrent attempts for the last unit: exactly one wins
    const results = await Promise.allSettled([placeOrder(a.id, seller.id, dish.id, 1), placeOrder(b.id, seller.id, dish.id, 1)]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect((await getDish(dish.id)).availableQty).toBe(0);
  });

  test('refuses negative / fractional quantities and kitchens that are not accepting orders', async () => {
    const { seller, dish } = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await expect(placeOrder(buyer.id, seller.id, dish.id, -1)).rejects.toMatchObject({ status: 400 });
    await expect(placeOrder(buyer.id, seller.id, dish.id, 1.5)).rejects.toMatchObject({ status: 400 });
    await db.update(s.sellerProfiles).set({ listingState: 'delisted', isApproved: false }).where(eq(s.sellerProfiles.userId, seller.id));
    await expect(placeOrder(buyer.id, seller.id, dish.id, 1)).rejects.toMatchObject({ status: 400 });
    await expect(placeOrder(buyer.id, seller.id, dish.id, 1, { buyerApproved: false })).rejects.toMatchObject({ status: 403 });
  });

  test('expired subscription / unmoderated dish / no payment mode block ordering', async () => {
    const { seller, dish } = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await db.update(s.listings).set({ moderationStatus: 'pending' }).where(eq(s.listings.id, dish.id));
    await expect(placeOrder(buyer.id, seller.id, dish.id, 1)).rejects.toMatchObject({ status: 400 });
    await db.update(s.listings).set({ moderationStatus: 'approved' }).where(eq(s.listings.id, dish.id));
    await db.update(s.kitchenSubscriptions).set({ endsAt: new Date(Date.now() - 10 * 86_400_000), startsAt: new Date(Date.now() - 100 * 86_400_000) }).where(eq(s.kitchenSubscriptions.sellerId, seller.id));
    await expect(placeOrder(buyer.id, seller.id, dish.id, 1)).rejects.toMatchObject({ status: 400 });
    // pay-at-pickup-only kitchen: upi_now is refused
    const k2 = await makeLiveKitchen(db, { societyId, upi: false });
    await expect(placeOrder(buyer.id, k2.seller.id, k2.dish.id, 1, { foodPaymentMode: 'upi_now' })).rejects.toMatchObject({ status: 400 });
    await expect(placeOrder(buyer.id, k2.seller.id, k2.dish.id, 1, { foodPaymentMode: 'pay_at_pickup' })).resolves.toBeDefined();
  });
});

describe('markOrderPaid: exactly once', () => {
  test('two parallel callers → one winner, one notification, order moves to fee_paid, kitchen gets an accept window', async () => {
    const { markOrderPaid } = await import('@/lib/payments');
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 10 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const { orderId } = await placeOrder(buyer.id, seller.id, dish.id, 2);
    const results = await Promise.all([markOrderPaid(orderId, { razorpayPaymentId: 'pay_A' }), markOrderPaid(orderId, { razorpayPaymentId: 'pay_B' })]);
    expect(results.filter((r) => r.won).length).toBe(1);
    const o = await getOrder(orderId);
    expect(o.status).toBe('fee_paid');
    expect(o.acceptBy!.getTime()).toBeGreaterThan(Date.now());
    expect((await getDish(dish.id)).availableQty).toBe(8); // reserved once, not decremented again
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, seller.id), eq(s.notifications.href, '/seller/orders')));
    expect(notes.length).toBe(1);
    expect((await db.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, orderId), eq(s.orderEvents.status, 'fee_paid')))).length).toBe(1);
  });

  test('the kitchen cannot see an order before the fee is paid', async () => {
    const { seller, dish } = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const { orderId } = await placeOrder(buyer.id, seller.id, dish.id, 1);
    const { GET } = await import('@/app/api/seller/orders/route');
    await loginAs(seller.id);
    let r = await call(GET, jsonReq('/api/seller/orders', undefined, { method: 'GET' }));
    expect((r.json.orders as { id: number }[]).some((x) => x.id === orderId)).toBe(false);
    const { markOrderPaid } = await import('@/lib/payments');
    await markOrderPaid(orderId);
    r = await call(GET, jsonReq('/api/seller/orders', undefined, { method: 'GET' }));
    const mine = (r.json.orders as { id: number; buyerName: string }[]).find((x) => x.id === orderId)!;
    expect(mine).toBeDefined();
    expect(mine.buyerName).toMatch(/^Buyer #[A-Z]\d$/); // handle only, never a real name
  });

  test('a zero-charge order (fully covered by credit) skips Razorpay and goes straight to fee_paid', async () => {
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 10 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const referred = await makeUser(db, 'buyer', { societyId });
    const [o0] = await db.insert(s.orders).values({ buyerId: referred.id, type: 'home_delivery', sellerId: seller.id, subtotalInPaise: 1, totalInPaise: 1, otpCode: '1111' }).returning();
    await db.insert(s.referralCredits).values({ buyerId: buyer.id, referredUserId: referred.id, referredOrderId: o0.id, amountInPaise: 5000 });
    const r = await placeOrder(buyer.id, seller.id, dish.id, 2, { useCredit: true });
    expect(r.payment.mode).toBe('none');
    expect((await getOrder(r.orderId)).status).toBe('fee_paid');
  });
});

describe('verify route: ownership, signature, amount', () => {
  async function setup() {
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 20 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const other = await makeUser(db, 'buyer', { societyId });
    const a = await placeOrder(buyer.id, seller.id, dish.id, 1);
    const b = await placeOrder(other.id, seller.id, dish.id, 1);
    const payA = (await db.select().from(s.payments).where(eq(s.payments.orderId, a.orderId)))[0];
    const payB = (await db.select().from(s.payments).where(eq(s.payments.orderId, b.orderId)))[0];
    return { buyer, other, a, b, payA, payB };
  }
  const verify = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/payments/verify/route');
    return call(POST, jsonReq('/api/payments/verify', body));
  };

  test('one valid signature cannot mark someone else’s order paid', async () => {
    const { buyer, a, b, payA, payB } = await setup();
    await loginAs(buyer.id);
    // buyer A holds a valid signature for THEIR razorpay order but names order B
    const sigA = checkoutSignature(payA.razorpayOrderId!, 'pay_1');
    const r1 = await verify({ orderId: b.orderId, razorpay_order_id: payA.razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sigA });
    expect(r1.status).toBe(400);
    // buyer A uses B's razorpay order id (with a signature they can't actually forge, but even a valid one for B is not theirs)
    const sigB = checkoutSignature(payB.razorpayOrderId!, 'pay_2');
    const r2 = await verify({ orderId: b.orderId, razorpay_order_id: payB.razorpayOrderId, razorpay_payment_id: 'pay_2', razorpay_signature: sigB });
    expect(r2.status).toBe(400);
    expect((await getOrder(b.orderId)).status).toBe('placed');
    expect((await getOrder(a.orderId)).status).toBe('placed');
  });

  test('malformed or wrong signatures return 400 (never 500)', async () => {
    const { buyer, a, payA } = await setup();
    await loginAs(buyer.id);
    for (const sig of ['x', '', 'a'.repeat(200), 'zz']) {
      const r = await verify({ orderId: a.orderId, razorpay_order_id: payA.razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sig });
      expect(r.status).toBe(400);
    }
    const wrong = checkoutSignature(payA.razorpayOrderId!, 'pay_OTHER');
    expect((await verify({ orderId: a.orderId, razorpay_order_id: payA.razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: wrong })).status).toBe(400);
  });

  test('the rightful buyer with a valid signature succeeds exactly once', async () => {
    const { buyer, a, payA } = await setup();
    await loginAs(buyer.id);
    const body = { orderId: a.orderId, razorpay_order_id: payA.razorpayOrderId, razorpay_payment_id: 'pay_good', razorpay_signature: checkoutSignature(payA.razorpayOrderId!, 'pay_good') };
    expect((await verify(body)).status).toBe(200);
    expect((await getOrder(a.orderId)).status).toBe('fee_paid');
    expect((await verify(body)).status).toBe(200); // idempotent
    expect((await getOrder(a.orderId)).status).toBe('fee_paid');
  });

  test('live mode: payment fetched from Razorpay must be captured and match the stored amount', async () => {
    vi.resetModules();
    vi.doMock('@/lib/payments/razorpay', async (orig) => ({
      ...(await orig<typeof import('@/lib/payments/razorpay')>()),
      fetchRazorpayPayment: vi.fn(async (id: string) => (id === 'pay_short' ? { id, order_id: 'WILL_BE_SET', status: 'captured', amount: 1 } : { id, order_id: 'WILL_BE_SET', status: 'captured', amount: 2000 })),
    }));
    const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 20 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const { orderId } = await placeOrder(buyer.id, seller.id, dish.id, 2);
    const pay = (await db.select().from(s.payments).where(eq(s.payments.orderId, orderId)))[0];
    const razorpay = await import('@/lib/payments/razorpay');
    vi.mocked(razorpay.fetchRazorpayPayment).mockImplementation(async (id: string) => ({ id, order_id: pay.razorpayOrderId!, status: 'captured', amount: id === 'pay_short' ? 1 : 2000 }));
    process.env.MOCK_MODE = 'false';
    await loginAs(buyer.id);
    const { verifyAndMarkPaid } = await import('@/lib/payments/verify');
    const base = { userId: buyer.id, orderId, razorpay_order_id: pay.razorpayOrderId!, razorpay_payment_id: 'pay_short', razorpay_signature: checkoutSignature(pay.razorpayOrderId!, 'pay_short') };
    await expect(verifyAndMarkPaid(base)).rejects.toMatchObject({ status: 400 });
    expect((await getOrder(orderId)).status).toBe('placed');
    const good = { ...base, razorpay_payment_id: 'pay_full', razorpay_signature: checkoutSignature(pay.razorpayOrderId!, 'pay_full') };
    await expect(verifyAndMarkPaid(good)).resolves.toMatchObject({ kind: 'order', won: true });
    vi.doUnmock('@/lib/payments/razorpay');
    vi.resetModules();
  });
});
