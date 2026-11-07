import { beforeAll, describe, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, checkoutSignature, jsonReq, loginAs } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;

beforeAll(async () => {
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_value';
  process.env.MOCK_MODE = 'true'; process.env.PAYMENTS_ADAPTER = 'mock';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

async function place(k: Awaited<ReturnType<typeof makeLiveKitchen>>, qty = 1, buyer?: Awaited<ReturnType<typeof makeUser>>) {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const b = buyer ?? (await makeUser(db, 'buyer', { societyId }));
  return createHomeOrder({ buyerId: b.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty }], fulfillmentType: 'self_pickup' });
}

describe('provisional caps are enforced atomically at booking', () => {
  test('a verified kitchen has no provisional cap; a provisional one stops at 8 orders a day ("Fully booked today")', async () => {
    const free = await makeLiveKitchen(db, { societyId, qty: 100, price: 1000 });
    for (let i = 0; i < 10; i++) await place(free);
    const prov = await makeLiveKitchen(db, { societyId, qty: 100, price: 1000, fssai: 'provisional' });
    for (let i = 0; i < 8; i++) await place(prov);
    await expect(place(prov)).rejects.toMatchObject({ status: 409, message: 'Fully booked today' });
  });

  test('two simultaneous bookings at cap − 1: exactly one succeeds', async () => {
    const prov = await makeLiveKitchen(db, { societyId, qty: 100, price: 1000, fssai: 'provisional' });
    for (let i = 0; i < 7; i++) await place(prov);
    const results = await Promise.allSettled([place(prov), place(prov), place(prov)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
    expect((await db.select().from(s.orders).where(eq(s.orders.sellerId, prov.seller.id))).length).toBe(8);
  });

  test('the food-value caps: ₹2,500 a day and ₹25,000 in total', async () => {
    const a = await makeLiveKitchen(db, { societyId, qty: 100, price: 40_000, fssai: 'provisional' }); // ₹400 per portion
    await place(a, 6); // ₹2,400
    await expect(place(a, 1)).rejects.toMatchObject({ status: 409, message: 'Fully booked today' }); // ₹2,800 > ₹2,500 for the day
    const t = await makeLiveKitchen(db, { societyId, qty: 100, price: 100_000, fssai: 'provisional' });
    await db.update(s.sellerProfiles).set({ capOverrideJson: { maxOrdersPerDay: 50, maxFoodValuePerDayPaise: 100_000_000, maxFoodValueTotalPaise: 250_000 } }).where(eq(s.sellerProfiles.userId, t.seller.id));
    await place(t, 2);
    await expect(place(t, 1)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/provisional sales limit/) });
  });

  test('an admin override lifts the cap, and lapses on its expiry date', async () => {
    const k = await makeLiveKitchen(db, { societyId, qty: 100, price: 1000, fssai: 'provisional' });
    await db.update(s.sellerProfiles).set({ capOverrideJson: { maxOrdersPerDay: 12 } }).where(eq(s.sellerProfiles.userId, k.seller.id));
    for (let i = 0; i < 12; i++) await place(k);
    await expect(place(k)).rejects.toMatchObject({ status: 409 });
    await db.update(s.sellerProfiles).set({ capOverrideJson: { maxOrdersPerDay: 50, expiresAt: new Date(Date.now() - 1000).toISOString() } }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await expect(place(k)).rejects.toMatchObject({ status: 409 }); // expired override → back to 8
  });

  test('cancelled orders free their capacity; the day resets at 00:00 IST', async () => {
    const prov = await makeLiveKitchen(db, { societyId, qty: 100, price: 1000, fssai: 'provisional' });
    const first = await place(prov);
    for (let i = 0; i < 7; i++) await place(prov);
    await expect(place(prov)).rejects.toMatchObject({ status: 409 });
    await db.update(s.orders).set({ status: 'cancelled_by_buyer' }).where(eq(s.orders.id, first.orderId));
    await expect(place(prov)).resolves.toBeDefined();
    // yesterday's orders do not count against today's cap
    await db.update(s.orders).set({ createdAt: new Date(Date.now() - 36 * 3_600_000) }).where(eq(s.orders.sellerId, prov.seller.id));
    for (let i = 0; i < 8; i++) await place(prov);
  });

  test('a kitchen in the FSSAI "applied" tier (inside its 7-day window) or without any application cannot take orders; after the window it can', async () => {
    const k = await makeLiveKitchen(db, { societyId, qty: 10, fssai: 'provisional' });
    await db.update(s.sellerProfiles).set({ fssaiStatus: 'unverified', provisionalStartedAt: null }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await expect(place(k)).rejects.toMatchObject({ status: 400 }); // none
    await db.insert(s.fssaiApplications).values({ sellerId: k.seller.id, applicantName: 'A', kitchenAddress: 'x', status: 'filed_on_foscos', foscosRefNumber: 'R1', filedAt: new Date(Date.now() - 3 * 86_400_000) });
    await expect(place(k)).rejects.toMatchObject({ status: 400 }); // applied (day 3)
    await db.update(s.fssaiApplications).set({ filedAt: new Date(Date.now() - 9 * 86_400_000) }).where(eq(s.fssaiApplications.sellerId, k.seller.id));
    await expect(place(k)).resolves.toBeDefined(); // provisional
    await db.update(s.fssaiApplications).set({ filedAt: new Date(Date.now() - 60 * 86_400_000) }).where(eq(s.fssaiApplications.sellerId, k.seller.id));
    await expect(place(k)).rejects.toMatchObject({ status: 400 }); // provisional period (45 days) over
    await db.update(s.sellerProfiles).set({ fssaiStatus: 'verified' }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await expect(place(k)).resolves.toBeDefined(); // verified lifts everything
  });
});

describe('Sec 393 / 194-O sales tracking', () => {
  test('warns once at the warning level, pauses new orders at the pause level, each alert once per financial year', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const { checkTdsThresholds } = await import('@/lib/orders/tds');
    await setPlatformSetting('tdsWarnPaise', '300000');
    await setPlatformSetting('tdsPausePaise', '500000');
    const k = await makeLiveKitchen(db, { societyId, qty: 100, price: 100_000 });
    const complete = async (qty: number) => {
      const r = await place(k, qty);
      await db.update(s.orders).set({ status: 'completed', completedAt: new Date() }).where(eq(s.orders.id, r.orderId));
    };
    await complete(2); // ₹2,000 < ₹3,000
    expect(await checkTdsThresholds(k.seller.id)).toBe('none');
    await complete(2); // ₹4,000
    expect(await checkTdsThresholds(k.seller.id)).toBe('warned');
    expect(await checkTdsThresholds(k.seller.id)).toBe('none'); // exactly once
    await complete(2); // ₹6,000 ≥ ₹5,000
    expect(await checkTdsThresholds(k.seller.id)).toBe('paused');
    const alerts = await db.select().from(s.notifications).where(eq(s.notifications.userId, k.seller.id));
    expect(alerts.filter((n) => n.title === 'You are close to the tax threshold')).toHaveLength(1);
    expect(alerts.filter((n) => n.eventKey === 'listing_paused')).toHaveLength(1);
    await checkTdsThresholds(k.seller.id);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, k.seller.id))).filter((n) => n.eventKey === 'listing_paused')).toHaveLength(1);
    await expect(place(k, 1)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/not taking new orders/) });
    await setPlatformSetting('tdsWarnPaise', '40000000');
    await setPlatformSetting('tdsPausePaise', '50000000');
    await expect(place(k, 1)).resolves.toBeDefined();
  });
});

describe('₹1 UPI ownership verification', () => {
  async function newSeller(over: Partial<typeof s.sellerProfiles.$inferInsert> = {}) {
    const seller = await makeUser(db, 'seller', { societyId });
    await db.insert(s.sellerProfiles).values({ userId: seller.id, kitchenName: 'K', upiVpa: `cook${seller.id}@okbank`, legalName: 'Kamala Devi', panNameOnCard: 'KAMALA DEVI', ...over });
    return seller;
  }
  const profile = async (id: number) => (await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, id)))[0];

  test('mock provider: start → ₹1 → verified, VPA + registered name stored, ₹1 refunded, kitchen notified', async () => {
    const { startUpiVerification, completeMockVerification } = await import('@/lib/upi-verify');
    const seller = await newSeller();
    expect(await startUpiVerification(seller.id)).toMatchObject({ mode: 'mock', amountInPaise: 100 });
    expect((await profile(seller.id)).upiVerifyStatus).toBe('pending');
    const v = await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.sellerId, seller.id));
    await completeMockVerification(seller.id, v[0].id, 'success');
    const p = await profile(seller.id);
    expect(p).toMatchObject({ upiVerifyStatus: 'verified', upiVerifiedVpa: `cook${seller.id}@okbank`, upiVerifiedName: 'KAMALA DEVI' });
    expect(p.upiNameMatchScore).toBe(100);
    const [row] = await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.id, v[0].id));
    expect(row).toMatchObject({ status: 'verified', provider: 'mock', maskedAccount: '••••1234' });
    expect(row.refundId).toBeTruthy();
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, seller.id))).some((n) => n.title.includes('UPI ID verified'))).toBe(true);
    await expect(startUpiVerification(seller.id)).rejects.toMatchObject({ status: 409 }); // already verified
  });

  test('paid from a DIFFERENT UPI ID → mismatch, not verified; unreadable → manual review → admin approves', async () => {
    const { startUpiVerification, completeMockVerification, adminResolveVerification } = await import('@/lib/upi-verify');
    const a = await newSeller();
    await startUpiVerification(a.id);
    const [va] = await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.sellerId, a.id));
    await completeMockVerification(a.id, va.id, 'other_vpa');
    expect(await profile(a.id)).toMatchObject({ upiVerifyStatus: 'mismatch', upiVerifiedVpa: null });

    const b = await newSeller();
    await startUpiVerification(b.id);
    const [vb] = await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.sellerId, b.id));
    await completeMockVerification(b.id, vb.id, 'unreadable');
    expect((await profile(b.id)).upiVerifyStatus).toBe('needs_manual_review');
    const admin = await makeUser(db, 'admin');
    await adminResolveVerification(vb.id, admin.id, 'approve', 'screenshot shows the ID');
    expect(await profile(b.id)).toMatchObject({ upiVerifyStatus: 'verified', upiVerifiedVpa: `cook${b.id}@okbank` });
    await expect(adminResolveVerification(vb.id, admin.id, 'approve')).rejects.toMatchObject({ status: 409 });
  });

  test('a low PAN↔UPI name score flags the kitchen to admins but does not reject it', async () => {
    const { startUpiVerification, finalizeVerification } = await import('@/lib/upi-verify');
    const seller = await newSeller();
    await startUpiVerification(seller.id);
    const [v] = await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.sellerId, seller.id));
    const admin = await makeUser(db, 'admin');
    await finalizeVerification(v.id, { verifiedVpa: `cook${seller.id}@okbank`, registeredName: 'RAJESH SHARMA' });
    const p = await profile(seller.id);
    expect(p.upiVerifyStatus).toBe('verified');
    expect(p.upiNameMatchScore).toBeLessThan(70);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, admin.id))).some((n) => n.title === 'UPI name needs a look')).toBe(true);
  });

  test('changing the UPI ID un-verifies it and pauses the kitchen until the ₹1 check is repeated', async () => {
    const { startUpiVerification, completeMockVerification, onUpiIdChanged } = await import('@/lib/upi-verify');
    const { kitchenGate } = await import('@/lib/kitchen/gate');
    const k = await makeLiveKitchen(db, { societyId });
    expect((await kitchenGate(k.seller.id)).ok).toBe(true);
    await onUpiIdChanged(k.seller.id, 'newid@okbank');
    expect(await profile(k.seller.id)).toMatchObject({ upiVpa: 'newid@okbank', upiVerifyStatus: 'unverified', upiVerifiedVpa: null });
    const gate = await kitchenGate(k.seller.id);
    expect(gate.ok).toBe(false);
    expect(gate.checks.paymentDetails).toBe(false);
    await startUpiVerification(k.seller.id);
    const [v] = await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.sellerId, k.seller.id));
    await completeMockVerification(k.seller.id, v.id, 'success');
    expect((await kitchenGate(k.seller.id)).ok).toBe(true);
  });

  test('razorpay_checkout_vpa: ₹1 UPI order → captured → the payer VPA is read from the payment', async () => {
    vi.resetModules();
    process.env.MOCK_MODE = 'false'; process.env.RAZORPAY_KEY_ID = 'rzp_test_key'; delete process.env.PAYMENTS_ADAPTER; // test keys: real Razorpay path, no go-live guard
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('upiVerifyProvider', 'razorpay_checkout_vpa');
    const payer: Record<string, string | undefined> = {};
    let n = 0;
    vi.doMock('@/lib/payments/razorpay', async (orig) => ({
      ...(await orig<typeof import('@/lib/payments/razorpay')>()),
      createRazorpayOrder: vi.fn(async () => ({ id: `order_u${++n}`, keyId: 'rzp_test_key' })),
      fetchRazorpayPayment: vi.fn(async (id: string) => ({ id, order_id: `order_u${id === 'pay_a' ? 1 : 2}`, status: 'captured', amount: 100, vpa: payer[id] })),
      createRazorpayRefund: vi.fn(async () => ({ id: 'rfnd_u1', status: 'processed' as const })),
    }));
    const { startUpiVerification, completeCheckoutVerification } = await import('@/lib/upi-verify');
    const seller = await newSeller();
    payer.pay_a = `cook${seller.id}@okbank`;
    const st = await startUpiVerification(seller.id);
    expect(st).toMatchObject({ mode: 'razorpay', amountInPaise: 100, razorpayOrderId: 'order_u1' });
    const finish = (sellerId: number, verificationId: number, orderId: string, pay: string, sig = checkoutSignature(orderId, pay)) =>
      completeCheckoutVerification({ sellerId, verificationId, razorpay_order_id: orderId, razorpay_payment_id: pay, razorpay_signature: sig });
    await expect(finish(seller.id + 999, st.verificationId, 'order_u1', 'pay_a')).rejects.toMatchObject({ status: 400 }); // someone else's verification
    await expect(finish(seller.id, st.verificationId, 'order_u1', 'pay_a', 'bad')).rejects.toMatchObject({ status: 400 }); // bad signature
    await finish(seller.id, st.verificationId, 'order_u1', 'pay_a');
    expect(await profile(seller.id)).toMatchObject({ upiVerifyStatus: 'verified', upiVerifiedVpa: `cook${seller.id}@okbank` });
    // the payment carries no payer VPA → manual review with a screenshot
    const other = await newSeller();
    const st2 = await startUpiVerification(other.id);
    expect(st2).toMatchObject({ razorpayOrderId: 'order_u2' });
    await finish(other.id, st2.verificationId, 'order_u2', 'pay_b');
    expect((await profile(other.id)).upiVerifyStatus).toBe('needs_manual_review');
    vi.doUnmock('@/lib/payments/razorpay');
    vi.resetModules();
    process.env.MOCK_MODE = 'true'; process.env.PAYMENTS_ADAPTER = 'mock';
    await setPlatformSetting('upiVerifyProvider', 'razorpay_checkout_vpa');
  });

  test('RazorpayX response parsing keeps only the last 4 of an account number', async () => {
    const { parseValidation } = await import('@/lib/upi-verify/razorpayx');
    const v = parseValidation({ id: 'fav_1', status: 'completed', upi_intent: { link: 'upi://pay?x=1', vpa: 'a@b' }, results: { registered_name: 'KAMALA DEVI' }, bank_account: { account_number: '123456789012', ifsc: 'HDFC0001234', bank_name: 'HDFC' } });
    expect(v).toMatchObject({ id: 'fav_1', status: 'completed', vpa: 'a@b', registeredName: 'KAMALA DEVI', maskedAccount: '••••9012', ifsc: 'HDFC0001234', bankName: 'HDFC' });
    expect(JSON.stringify(v)).not.toContain('123456789012');
  });

  test('routes: only a seller can start; the profile PATCH stores PAN encrypted and returns it masked', async () => {
    const seller = await newSeller();
    const { POST } = await import('@/app/api/seller/upi-verify/route');
    const buyer = await makeUser(db, 'buyer', { societyId });
    await loginAs(buyer.id);
    expect((await call(POST, jsonReq('/api/seller/upi-verify'))).status).toBe(403);
    await loginAs(seller.id);
    expect((await call(POST, jsonReq('/api/seller/upi-verify'))).status).toBe(200);
    const { PATCH, GET } = await import('@/app/api/seller/profile/route');
    const r = await call(PATCH, jsonReq('/api/seller/profile', { step: 'tax', data: { pan: 'abcde1234f', gstin: '' } }, { method: 'PATCH' }));
    expect(r.status).toBe(200);
    expect(r.json.panMasked).toBe('ABCDE****F');
    expect(JSON.stringify(r.json)).not.toContain('ABCDE1234F');
    const p = await profile(seller.id);
    expect(p.panEnc).toBeTruthy();
    expect(p.panEnc).not.toContain('ABCDE1234F');
    const { decryptPan } = await import('@/lib/pan');
    expect(decryptPan(p.panEnc!)).toBe('ABCDE1234F');
    expect(JSON.stringify((await call(GET as never, jsonReq('/api/seller/profile', undefined, { method: 'GET' }))).json)).not.toContain('ABCDE1234F');
    expect((await call(PATCH, jsonReq('/api/seller/profile', { step: 'tax', data: { pan: 'NOTAPAN123', gstin: '' } }, { method: 'PATCH' }))).status).toBe(400);
  });
});
