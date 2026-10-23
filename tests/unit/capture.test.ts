import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, checkoutSignature, webhookReq } from '../helpers/http';
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
  const { seedSubscriptionPlans } = await import('@/lib/subscriptions/plans');
  await seedSubscriptionPlans(db);
});
afterEach(() => {
  process.env.MOCK_MODE = 'true';
  vi.doUnmock('@/lib/payments/razorpay');
  vi.resetModules();
});

type Status = 'captured' | 'authorized' | 'failed';
/** Stubs the Razorpay adapter: fetch returns `first` until capture() runs, then `afterCapture`. */
async function stubRazorpay(opts: { first: Status; captureFails?: boolean; afterCapture?: Status }) {
  vi.resetModules();
  let state: Status = opts.first;
  const capture = vi.fn(async () => {
    if (opts.captureFails) throw new Error('capture rejected by gateway');
    state = opts.afterCapture ?? 'captured';
    return { id: 'pay_1', order_id: '', status: state, amount: 0 };
  });
  const fetchPayment = vi.fn();
  vi.doMock('@/lib/payments/razorpay', async (orig) => ({
    ...(await orig<typeof import('@/lib/payments/razorpay')>()),
    fetchRazorpayPayment: fetchPayment,
    captureRazorpayPayment: capture,
  }));
  return {
    capture,
    bind: (orderId: string, amount: number) => fetchPayment.mockImplementation(async (id: string) => ({ id, order_id: orderId, status: state, amount })),
  };
}

async function pendingOrder() {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const { seller, dish } = await makeLiveKitchen(db, { societyId, qty: 20 });
  const buyer = await makeUser(db, 'buyer', { societyId });
  const r = await createHomeOrder({ buyerId: buyer.id, buyerApproved: true, sellerId: seller.id, items: [{ id: dish.id, qty: 2 }], fulfillmentType: 'self_pickup', foodPaymentMode: 'upi_now' });
  const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, r.orderId));
  return { buyer, orderId: r.orderId, rzpOrderId: pay.razorpayOrderId!, amount: pay.amountInPaise };
}
const orderStatus = async (id: number) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0].status;

async function verify(p: Awaited<ReturnType<typeof pendingOrder>>, paymentId = 'pay_cap') {
  const { verifyAndMarkPaid } = await import('@/lib/payments/verify');
  return verifyAndMarkPaid({ userId: p.buyer.id, orderId: p.orderId, razorpay_order_id: p.rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(p.rzpOrderId, paymentId) });
}

describe('live mode: only a captured payment marks an order fee as paid', () => {
  test('captured → paid, no capture call', async () => {
    const p = await pendingOrder();
    const rzp = await stubRazorpay({ first: 'captured' });
    rzp.bind(p.rzpOrderId, p.amount);
    process.env.MOCK_MODE = 'false';
    await expect(verify(p)).resolves.toMatchObject({ kind: 'order', won: true });
    expect(rzp.capture).not.toHaveBeenCalled();
    expect(await orderStatus(p.orderId)).toBe('fee_paid');
  });

  test('authorized → captured (stored amount, INR) → then paid', async () => {
    const p = await pendingOrder();
    const rzp = await stubRazorpay({ first: 'authorized' });
    rzp.bind(p.rzpOrderId, p.amount);
    process.env.MOCK_MODE = 'false';
    await expect(verify(p)).resolves.toMatchObject({ kind: 'order', won: true });
    expect(rzp.capture).toHaveBeenCalledTimes(1);
    expect(rzp.capture).toHaveBeenCalledWith('pay_cap', p.amount);
    expect(await orderStatus(p.orderId)).toBe('fee_paid');
  });

  test('authorized + capture failure → clear error, order stays unpaid', async () => {
    const p = await pendingOrder();
    const rzp = await stubRazorpay({ first: 'authorized', captureFails: true });
    rzp.bind(p.rzpOrderId, p.amount);
    process.env.MOCK_MODE = 'false';
    await expect(verify(p)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/could not capture/i) });
    expect(await orderStatus(p.orderId)).toBe('placed');
  });

  test('capture call that does not end up captured → not paid', async () => {
    const p = await pendingOrder();
    const rzp = await stubRazorpay({ first: 'authorized', afterCapture: 'failed' });
    rzp.bind(p.rzpOrderId, p.amount);
    process.env.MOCK_MODE = 'false';
    await expect(verify(p)).rejects.toMatchObject({ status: 502 });
    expect(await orderStatus(p.orderId)).toBe('placed');
  });

  test('a wrong amount is never captured', async () => {
    const p = await pendingOrder();
    const rzp = await stubRazorpay({ first: 'authorized' });
    rzp.bind(p.rzpOrderId, 1);
    process.env.MOCK_MODE = 'false';
    await expect(verify(p)).rejects.toMatchObject({ status: 400 });
    expect(rzp.capture).not.toHaveBeenCalled();
    expect(await orderStatus(p.orderId)).toBe('placed');
  });
});

describe('live mode: kitchen subscription follows the same rule', () => {
  async function pendingSub() {
    const seller = await makeUser(db, 'seller', { societyId });
    const { startSubscriptionPayment } = await import('@/lib/subscriptions/service');
    const co = await startSubscriptionPayment(seller.id, (await db.select().from(s.subscriptionPlans))[0].id);
    const [sub] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, co.subscriptionId));
    return { seller, sub, amount: sub.pricePaiseSnapshot + sub.gstPaise };
  }
  const subStatus = async (id: number) => (await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, id)))[0].status;
  const run = async (x: Awaited<ReturnType<typeof pendingSub>>) => {
    const { verifyAndMarkPaid } = await import('@/lib/payments/verify');
    return verifyAndMarkPaid({ userId: x.seller.id, subscriptionId: x.sub.id, razorpay_order_id: x.sub.razorpayOrderId!, razorpay_payment_id: 'pay_sub', razorpay_signature: checkoutSignature(x.sub.razorpayOrderId!, 'pay_sub') });
  };

  test('authorized → captured then active; capture failure leaves it unpaid', async () => {
    const a = await pendingSub();
    let rzp = await stubRazorpay({ first: 'authorized' });
    rzp.bind(a.sub.razorpayOrderId!, a.amount);
    process.env.MOCK_MODE = 'false';
    await expect(run(a)).resolves.toMatchObject({ kind: 'subscription', won: true });
    expect(rzp.capture).toHaveBeenCalledWith('pay_sub', a.amount);
    expect(await subStatus(a.sub.id)).toBe('active');

    process.env.MOCK_MODE = 'true';
    const b = await pendingSub();
    rzp = await stubRazorpay({ first: 'authorized', captureFails: true });
    rzp.bind(b.sub.razorpayOrderId!, b.amount);
    process.env.MOCK_MODE = 'false';
    await expect(run(b)).rejects.toMatchObject({ status: 502 });
    expect(await subStatus(b.sub.id)).toBe('pending_payment');
  });
});

describe('live mode: webhook applies the same rule', () => {
  const post = async (body: unknown, eventId: string) => {
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    return call(POST as never, webhookReq(body, { eventId }) as never);
  };
  const evt = (event: string, orderId: string, amount: number, id = 'pay_wh') => ({ event, payload: { payment: { entity: { id, order_id: orderId, amount, method: 'upi' } } } });

  test('payment.authorized → capture → paid', async () => {
    const p = await pendingOrder();
    const rzp = await stubRazorpay({ first: 'authorized' });
    rzp.bind(p.rzpOrderId, p.amount);
    process.env.MOCK_MODE = 'false';
    const res = await post(evt('payment.authorized', p.rzpOrderId, p.amount), 'evt_auth_ok');
    expect(res.status).toBe(200);
    expect(rzp.capture).toHaveBeenCalledWith('pay_wh', p.amount);
    expect(await orderStatus(p.orderId)).toBe('fee_paid');
  });

  test('capture failure → 500 (Razorpay retries), order unpaid, and the retry succeeds', async () => {
    const p = await pendingOrder();
    let rzp = await stubRazorpay({ first: 'authorized', captureFails: true });
    rzp.bind(p.rzpOrderId, p.amount);
    process.env.MOCK_MODE = 'false';
    expect((await post(evt('payment.authorized', p.rzpOrderId, p.amount), 'evt_auth_bad')).status).toBe(500);
    expect(await orderStatus(p.orderId)).toBe('placed');

    rzp = await stubRazorpay({ first: 'authorized' });
    rzp.bind(p.rzpOrderId, p.amount);
    expect((await post(evt('payment.authorized', p.rzpOrderId, p.amount), 'evt_auth_bad')).status).toBe(200);
    expect(await orderStatus(p.orderId)).toBe('fee_paid');
  });

  test('a payment.captured event is re-checked against Razorpay, not trusted', async () => {
    const p = await pendingOrder();
    const rzp = await stubRazorpay({ first: 'failed' });
    rzp.bind(p.rzpOrderId, p.amount);
    process.env.MOCK_MODE = 'false';
    expect((await post(evt('payment.captured', p.rzpOrderId, p.amount), 'evt_cap_lie')).status).toBe(500);
    expect(await orderStatus(p.orderId)).toBe('placed');
  });
});

describe('Razorpay order creation', () => {
  test('sets payment_capture: 1 (auto-capture)', async () => {
    vi.resetModules();
    const create = vi.fn(async () => ({ id: 'order_live_1' }));
    vi.doMock('razorpay', () => ({ default: class { orders = { create }; } }));
    process.env.MOCK_MODE = 'false';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    const { createRazorpayOrder } = await import('@/lib/payments/razorpay');
    await createRazorpayOrder({ amountInPaise: 2000, receipt: 'r1' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 2000, currency: 'INR', payment_capture: 1 }));
    vi.doUnmock('razorpay');
  });
});
