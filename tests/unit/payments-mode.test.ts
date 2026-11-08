import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { call, jsonReq, loginAs, webhookReq } from '../helpers/http';
import { resetRequestContext } from '../helpers/next-headers';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { _resetPaymentsModeWarning, paymentsMode, paymentsModeInfo } from '@/lib/payments/mode';
import { BRAND } from '@/config/brand';

vi.mock('next/headers', () => import('../helpers/next-headers'));
// The Razorpay SDK wrapper is stubbed: these tests are about WHICH path runs, never about the network.
const created: { kind?: string; ref?: unknown; receipt?: string }[] = [];
vi.mock('@/lib/payments/razorpay', async (orig) => ({
  ...(await orig<typeof import('@/lib/payments/razorpay')>()),
  createRazorpayOrder: async (i: { receipt: string; kind: string; ref: unknown }) => {
    created.push({ kind: i.kind, ref: i.ref, receipt: i.receipt });
    return { id: `order_stub_${created.length}_${Math.random().toString(36).slice(2, 6)}`, keyId: process.env.RAZORPAY_KEY_ID ?? null };
  },
  fetchRazorpayPayment: async (id: string) => ({ id, order_id: 'x', status: 'captured', amount: 0 }),
}));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
const saved = { ...process.env };
beforeAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});
afterEach(() => {
  for (const k of ['MOCK_MODE', 'PAYMENTS_ADAPTER', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetPaymentsModeWarning();
});
const env = (o: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};
const TEST_KEYS = { RAZORPAY_KEY_ID: 'rzp_test_abc123', RAZORPAY_KEY_SECRET: 'secret_value_1234' };
const LIVE_KEYS = { RAZORPAY_KEY_ID: 'rzp_live_abc123', RAZORPAY_KEY_SECRET: 'secret_value_1234' };

describe('R1: paymentsMode()', () => {
  test.each([
    ['PAYMENTS_ADAPTER=mock overrides real keys', { PAYMENTS_ADAPTER: 'mock', ...LIVE_KEYS }, 'mock'],
    ['no key id', { RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: 'x' }, 'mock'],
    ['no key secret', { RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: undefined }, 'mock'],
    ['rzp_test_ prefix', TEST_KEYS, 'razorpay_test'],
    ['rzp_live_ prefix', LIVE_KEYS, 'razorpay_live'],
  ])('%s → %s', (_n, vars, want) => {
    const e: Record<string, string | undefined> = Object.assign({ PAYMENTS_ADAPTER: undefined, RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, vars);
    expect(paymentsMode(e)).toBe(want);
  });

  test('any other prefix refuses payments (503), logs a configuration error that names only the prefix, and never the secret part', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((l) => void lines.push(String(l)));
    const e = { RAZORPAY_KEY_ID: 'rzp_xyz_SECRETPART12345', RAZORPAY_KEY_SECRET: 'sss' };
    expect(() => paymentsMode(e)).toThrowError(/rzp_test_ or rzp_live_/);
    try {
      paymentsMode(e);
    } catch (err) {
      expect((err as { status: number }).status).toBe(503);
    }
    spy.mockRestore();
    const logged = lines.join('\n');
    expect(logged).toContain('payments.config');
    expect(logged).toContain('rzp_xyz_');
    expect(logged).not.toContain('SECRETPART');
    expect(paymentsModeInfo(e)).toEqual({ mode: null, prefix: 'rzp_xyz_' });
    expect(paymentsModeInfo({ RAZORPAY_KEY_ID: 'garbage', RAZORPAY_KEY_SECRET: 'x' })).toEqual({ mode: null, prefix: '(unrecognised)' });
  });

  test('the script classifies keys exactly like the app', async () => {
    const { classify } = await import('../../scripts/razorpay-check.mjs');
    for (const e of [{ PAYMENTS_ADAPTER: 'mock', ...LIVE_KEYS }, {}, TEST_KEYS, LIVE_KEYS, { RAZORPAY_KEY_ID: 'zzz_', RAZORPAY_KEY_SECRET: 's' }]) {
      const app = paymentsModeInfo(e as Record<string, string>);
      expect(classify(e as Record<string, string>).mode).toBe(app.mode ?? 'invalid');
      expect(classify(e as Record<string, string>).prefix).toBe(app.prefix);
    }
  });

  test('no payment module still imports isMockMode (MOCK_MODE only governs the non-payment adapters)', () => {
    const root = path.join(__dirname, '../../src');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = [
      ...walk(path.join(root, 'lib/payments')),
      ...walk(path.join(root, 'lib/subscriptions')),
      ...walk(path.join(root, 'lib/upi-verify')),
      ...walk(path.join(root, 'app/api/payments')),
      ...walk(path.join(root, 'app/api/webhooks')),
      ...walk(path.join(root, 'app/api/plus')),
      ...walk(path.join(root, 'app/api/seller/upi-verify')),
      ...walk(path.join(root, 'app/checkout')),
      path.join(root, 'lib/plus.ts'),
      path.join(root, 'lib/meal-plans.ts'),
      path.join(root, 'lib/bulk.ts'),
      path.join(root, 'lib/orders/create.ts'),
    ].filter((f) => /\.(ts|tsx)$/.test(f));
    const offenders = files.filter((f) => /isMockMode/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});

describe('R2/R3: rules per mode and the mock-only routes', () => {
  const mockOnly = async () => {
    const complete = await import('@/app/api/payments/mock-complete/route');
    const plus = await import('@/app/api/plus/complete/route');
    const upi = await import('@/app/api/seller/upi-verify/complete/route');
    return [
      ['payments/mock-complete', complete.POST, { orderId: 1, outcome: 'success' }],
      ['plus/complete', plus.POST, { membershipId: 1, mock: true }],
      ['seller/upi-verify/complete', upi.POST, { mode: 'mock', verificationId: 1, outcome: 'success' }],
    ] as const;
  };

  test.each([
    ['razorpay_test', TEST_KEYS],
    ['razorpay_live', { ...LIVE_KEYS, MOCK_MODE: 'false' }],
  ])('in %s every mock-only route is a 404, even for a signed-in caller', async (_m, vars) => {
    env({ PAYMENTS_ADAPTER: undefined, ...vars });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const seller = (await makeLiveKitchen(db, { societyId })).seller;
    for (const [name, handler, body] of await mockOnly()) {
      resetRequestContext();
      if (name === 'payments/mock-complete') expect((await call(handler as never, jsonReq(`/api/${name}`, body))).status, `${name} anonymous`).toBe(404);
      await loginAs(name.startsWith('seller') ? seller.id : buyer.id);
      expect((await call(handler as never, jsonReq(`/api/${name}`, body))).status, `${name} signed in`).toBe(404);
    }
  });

  test('in mock mode the fake routes still work (they reach their own checks, not a 404)', async () => {
    env({ PAYMENTS_ADAPTER: 'mock', ...LIVE_KEYS });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await loginAs(buyer.id);
    const { POST } = await import('@/app/api/payments/mock-complete/route');
    expect((await call(POST as never, jsonReq('/x', { orderId: 999999, outcome: 'success' }))).status).toBe(404); // order not found: its own 404 text
    const r = await call(POST as never, jsonReq('/x', { orderId: 999999, outcome: 'success' }));
    expect(JSON.stringify(r.json)).toContain('Order not found');
  });

  test('payload modes: the fake sheet is only ever offered in mock; test and live keys get the real Checkout', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const place = async () => (await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).payment.mode;
    env({ PAYMENTS_ADAPTER: 'mock', ...TEST_KEYS });
    expect(await place()).toBe('mock');
    env({ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS });
    expect(await place()).toBe('razorpay');
    env({ PAYMENTS_ADAPTER: undefined, MOCK_MODE: 'false', RAZORPAY_KEY_ID: 'rzp_test_other', RAZORPAY_KEY_SECRET: 'secret_value_1234' });
    expect(await place()).toBe('razorpay');
  });

  test('test keys: no go-live guard, whatever MOCK_MODE says; real orders are tagged', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    for (const mock of ['true', 'false']) {
      env({ PAYMENTS_ADAPTER: undefined, MOCK_MODE: mock, ...TEST_KEYS });
      const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
      expect(r.payment.mode).toBe('razorpay');
    }
    expect(created.at(-1)).toMatchObject({ kind: 'order_fee' });
    expect(created.at(-1)?.receipt).toMatch(/^kt-/);
  });

  test('live keys with MOCK_MODE=true refuse every money-taking action with the instruction', async () => {
    env({ PAYMENTS_ADAPTER: undefined, MOCK_MODE: 'true', ...LIVE_KEYS });
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { startSubscriptionPayment } = await import('@/lib/subscriptions/service');
    const { startPurchase } = await import('@/lib/plus');
    const { startUpiVerification } = await import('@/lib/upi-verify');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('plusEnabled', 'true');
    const k = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const msg = { status: 503, message: expect.stringContaining('MOCK_MODE=false') };
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject(msg);
    await expect(startSubscriptionPayment(k.seller.id, 1)).rejects.toMatchObject(msg);
    await expect(startPurchase(buyer.id, true)).rejects.toMatchObject(msg);
    await expect(startUpiVerification(k.seller.id)).rejects.toMatchObject(msg);
    await setPlatformSetting('plusEnabled', 'false');
  });

  test('live keys with MOCK_MODE=false: the configuration rows still gate every money action', async () => {
    env({ PAYMENTS_ADAPTER: undefined, MOCK_MODE: 'false', ...LIVE_KEYS });
    const { startSubscriptionPayment } = await import('@/lib/subscriptions/service');
    const { startUpiVerification } = await import('@/lib/upi-verify');
    const k = await makeLiveKitchen(db, { societyId });
    await expect(startSubscriptionPayment(k.seller.id, 1)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Go-live') });
    await expect(startUpiVerification(k.seller.id)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Go-live') });
  });
});

describe('R4: a shared Razorpay account', () => {
  const post = async (body: unknown, opts: { eventId: string; badSig?: boolean }) => {
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    return call(POST as never, webhookReq(body, opts) as never);
  };
  const counts = async () => ({
    orders: (await db.select().from(s.orders)).length,
    payments: (await db.select().from(s.payments)).length,
    refunds: (await db.select().from(s.refunds)).length,
    subs: (await db.select().from(s.kitchenSubscriptions)).length,
  });

  test('orders are tagged app/env/kind/ref and receipts start with kt-', async () => {
    env({ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS });
    const create = vi.fn(async () => ({ id: 'order_tagged' }));
    vi.doMock('razorpay', () => ({ default: class { orders = { create }; } }));
    process.env.SITE_URL = `https://${BRAND.slug}.example.in`;
    const real = await vi.importActual<typeof import('@/lib/payments/razorpay')>('@/lib/payments/razorpay');
    await real.createRazorpayOrder({ amountInPaise: 2000, receipt: real.receiptFor('o', 7), kind: 'meal_plan', ref: 7, notes: { orderId: '7' } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ receipt: 'kt-o7', notes: expect.objectContaining({ app: BRAND.slug, env: `${BRAND.slug}.example.in`, kind: 'meal_plan', ref: '7', orderId: '7' }) }));
    await expect(real.createRazorpayOrder({ amountInPaise: 2000, receipt: 'plain-1', kind: 'plus', ref: 1 })).rejects.toThrow(/kt-/);
    vi.doUnmock('razorpay');
  });

  test('a foreign payment.captured is acknowledged with 200 ignored_foreign and changes nothing but the dedupe row', async () => {
    env({ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS });
    const before = await counts();
    const evt = (notes?: Record<string, string>) => ({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_other_app', order_id: 'order_OTHER1', amount: 49900, method: 'upi', notes } } } });
    const a = await post(evt(), { eventId: 'evt_foreign_1' });
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ outcome: 'ignored_foreign' });
    const b = await post(evt({ app: 'someone-else' }), { eventId: 'evt_foreign_2' });
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ outcome: 'ignored_foreign' });
    expect(await counts()).toEqual(before);
    expect((await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, 'evt_foreign_1')))[0]).toMatchObject({ outcome: 'ignored_foreign' });
  });

  test('a foreign refund.processed → 200 ignored_foreign; a foreign payment.failed too', async () => {
    env({ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS });
    const r = await post({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_other', payment_id: 'pay_other' } } } }, { eventId: 'evt_foreign_3' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ outcome: 'ignored_foreign' });
    const f = await post({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_other', order_id: 'order_OTHER2', amount: 100 } } } }, { eventId: 'evt_foreign_4' });
    expect(f.status).toBe(200);
    expect(f.json).toMatchObject({ outcome: 'ignored_foreign' });
  });

  test('a foreign RazorpayX validation event is ignored too', async () => {
    env({ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS });
    const r = await post({ event: 'fund_account.validation.completed', payload: { fund_account_validation: { entity: { id: 'fav_other_app', status: 'completed' } } } }, { eventId: 'evt_foreign_5' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ outcome: 'ignored_foreign' });
  });

  test('a bad signature is still a 400, and our own events behave exactly as before', async () => {
    env({ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS });
    const bad = await post({ event: 'payment.captured', payload: {} }, { eventId: 'evt_bad', badSig: true });
    expect(bad.status).toBe(400);
    // ours: a pending order fee captured → paid (live-style amount check against the stub below)
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    const o = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, o.orderId));
    const razorpay = await import('@/lib/payments/razorpay');
    vi.spyOn(razorpay, 'fetchRazorpayPayment').mockImplementation(async (id: string) => ({ id, order_id: pay.razorpayOrderId!, status: 'captured', amount: pay.amountInPaise }));
    const ours = await post({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_ours_1', order_id: pay.razorpayOrderId, amount: pay.amountInPaise, method: 'upi', notes: { app: BRAND.slug } } } } }, { eventId: 'evt_ours_1' });
    expect(ours.status).toBe(200);
    expect(ours.json).toMatchObject({ outcome: 'order_paid' });
    expect((await db.select().from(s.orders).where(eq(s.orders.id, o.orderId)))[0].status).toBe('booked');
  });

  test('webhook event ids are purged after the retention period', async () => {
    const { runRetention } = await import('@/lib/retention');
    await db.insert(s.webhookEvents).values({ id: 'evt_old_foreign', type: 'payment.captured', outcome: 'ignored_foreign', receivedAt: new Date(Date.now() - 31 * 86_400_000) });
    const r = await runRetention();
    expect(r.webhookEvents).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, 'evt_old_foreign'))).length).toBe(0);
    expect((await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, 'evt_foreign_1'))).length).toBe(1);
  });
});

describe('R5: checkout look and feel', () => {
  test('the Razorpay Checkout theme colour is the design token `leaf`', async () => {
    const { RAZORPAY_THEME } = await import('@/components/razorpay');
    const cfg = (await import('../../tailwind.config')).default as unknown as { theme: { extend: { colors: { leaf: { DEFAULT: string } } } } };
    expect(RAZORPAY_THEME.toLowerCase()).toBe(cfg.theme.extend.colors.leaf.DEFAULT.toLowerCase());
  });
});

describe('R5/R6: health, go-live row and the key check script', () => {
  test('/api/health reports paymentsMode and never a key', async () => {
    const { GET } = await import('@/app/api/health/route');
    for (const [vars, want] of [
      [{ PAYMENTS_ADAPTER: undefined, RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, 'mock'],
      [{ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS }, 'razorpay_test'],
      [{ PAYMENTS_ADAPTER: undefined, ...LIVE_KEYS }, 'razorpay_live'],
      [{ PAYMENTS_ADAPTER: undefined, RAZORPAY_KEY_ID: 'bogus_key', RAZORPAY_KEY_SECRET: 'x' }, 'invalid_key'],
    ] as const) {
      env(vars as Record<string, string | undefined>);
      const res = await GET();
      const text = JSON.stringify(await res.json());
      expect(text).toContain(`"paymentsMode":"${want}"`);
      expect(text).not.toContain('abc123');
      expect(text).not.toContain('secret_value');
    }
  });

  test('go-live "Payments mode" row: an ops row that never blocks', async () => {
    const { buildGoLiveRows, liveBlockers } = await import('@/lib/go-live');
    const { SETTING_DEFS } = await import('@/lib/settings/defs');
    const settings = Object.fromEntries(Object.entries(SETTING_DEFS).map(([k, d]) => [k, (d as { def: unknown }).def])) as never;
    const row = (f: Record<string, unknown>) => buildGoLiveRows(settings, {}, { storageReachable: true, cronFresh: true, legalAllReviewed: true, legalCount: 1, ...f }).find((r) => r.key === 'paymentsMode')!;
    expect(row({ paymentsMode: 'mock' })).toMatchObject({ status: 'warn', kind: 'ops', blocking: false });
    expect(row({ paymentsMode: 'razorpay_test', keyPrefix: 'rzp_test_' })).toMatchObject({ status: 'warn', blocking: false });
    expect(row({ paymentsMode: 'razorpay_live', mockMode: true })).toMatchObject({ status: 'missing', blocking: false });
    expect(row({ paymentsMode: 'razorpay_live', mockMode: false })).toMatchObject({ status: 'ok' });
    expect(JSON.stringify(row({ paymentsMode: 'razorpay_live', mockMode: false }))).not.toMatch(/secret_value|abc123/);
    const all = buildGoLiveRows(settings, {}, { storageReachable: true, cronFresh: true, legalAllReviewed: true, legalCount: 1, paymentsMode: 'razorpay_live', mockMode: true });
    expect(liveBlockers(all).map((r) => r.key)).not.toContain('paymentsMode');
  });

  test('razorpay:check refuses mock mode, reports a 401 plainly, and on success creates, fetches and prints the order without capturing', async () => {
    const { run } = await import('../../scripts/razorpay-check.mjs');
    const mock = await run({ env: {} as Record<string, string> });
    expect(mock.code).toBe(2);
    expect(mock.lines.join('\n')).toMatch(/mock/);

    const rejected = await run({ env: TEST_KEYS as Record<string, string>, createClient: () => ({ orders: { create: async () => Promise.reject({ statusCode: 401, error: { description: 'Authentication failed' } }), fetch: async () => ({}) } }) });
    expect(rejected.code).toBe(1);
    expect(rejected.lines.join('\n')).toContain('Razorpay rejected the keys: check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.');

    const calls: Record<string, unknown>[] = [];
    const ok = await run({
      env: TEST_KEYS as Record<string, string>,
      createClient: () => ({
        orders: {
          create: async (o: Record<string, unknown>) => (calls.push(o), { id: 'order_smoke1' }),
          fetch: async (id: string) => ({ id, status: 'created', amount: 100, receipt: String(calls[0].receipt) }),
        },
      }),
    });
    expect(ok.code).toBe(0);
    const out = ok.lines.join('\n');
    expect(out).toContain('Payments mode: razorpay_test (key prefix rzp_test_)');
    expect(out).toContain('order_smoke1');
    expect(out).toContain('status created');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('secret_value');
    expect(calls[0]).toMatchObject({ amount: 100, currency: 'INR', notes: expect.objectContaining({ app: BRAND.slug, kind: 'smoke' }) });
    expect(String(calls[0].receipt)).toMatch(/^kt-smoke-\d+$/);
  });
});

describe('Rebrand: identifiers that leave the system', () => {
  test('receipts are kt- for new orders; the webhook helpers still recognise pp- receipts and the old notes.app slug', async () => {
    const { BRAND } = await import('@/config/brand');
    const { receiptFor, isOurReceipt, isOurAppTag } = await vi.importActual<typeof import('@/lib/payments/razorpay')>('@/lib/payments/razorpay');
    expect(receiptFor('o', 12)).toBe('kt-o12');
    expect(isOurReceipt('kt-o12')).toBe(true);
    expect(isOurReceipt('pp-o12')).toBe(true); // orders already created on the shared account
    expect(isOurReceipt('other-o12')).toBe(false);
    expect(isOurReceipt(undefined)).toBe(false);
    expect(isOurAppTag('kootu')).toBe(true);
    expect(isOurAppTag(BRAND.legacySlugs[0])).toBe(true);
    expect(isOurAppTag('someone-else')).toBe(false);
    expect(isOurAppTag(undefined)).toBe(false);
  });

  test('the webhook treats both the new and the old notes.app as ours, and everything else on the account as foreign', async () => {
    env({ PAYMENTS_ADAPTER: undefined, ...TEST_KEYS });
    const { BRAND } = await import('@/config/brand');
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    const post = (body: unknown, eventId: string) => call(POST as never, webhookReq(body, { eventId }) as never);
    const evt = (app: string) => ({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_NOROW', amount: 100, notes: { app } } } } });
    // ours under either name: it passes the tag check and then is "unknown order" (no matching row), which is also acknowledged without side effects
    for (const [i, app] of [BRAND.slug, ...BRAND.legacySlugs].entries()) {
      const r = await post(evt(app), `evt_rebrand_${i}`);
      expect(r.status).toBe(200);
    }
    const foreign = await post(evt('someone-else'), 'evt_rebrand_foreign');
    expect(foreign.json).toMatchObject({ outcome: 'ignored_foreign' });
  });
});
