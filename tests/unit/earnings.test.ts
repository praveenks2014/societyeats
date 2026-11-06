import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { call, jsonReq, loginAs } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

async function completed(k: Awaited<ReturnType<typeof makeLiveKitchen>>, completedAt: Date, qty = 1) {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const { markOrderPaid } = await import('@/lib/payments');
  const buyer = await makeUser(db, 'buyer', { societyId });
  const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty }], fulfillmentType: 'self_pickup' });
  await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
  await db.update(s.orders).set({ status: 'completed', acceptedAt: completedAt, completedAt, foodPaymentMethod: 'upi', foodPaymentUtr: '123456789012' }).where(eq(s.orders.id, r.orderId));
  return r.orderId;
}

describe('seller earnings (A3)', () => {
  test('by financial year and month (IST), acceptance rate, cancellations by cause', async () => {
    const { sellerEarnings, fyStartOfYear } = await import('@/lib/orders/earnings');
    const k = await makeLiveKitchen(db, { societyId, qty: 100, price: 10000 });
    await completed(k, new Date('2026-04-30T19:00:00Z')); // 1 May 00:30 IST: counts in MAY
    await completed(k, new Date('2026-04-15T10:00:00Z'), 2);
    await completed(k, new Date('2025-12-01T10:00:00Z')); // FY 2025-26
    await completed(k, new Date('2026-03-31T19:00:00Z')); // 1 Apr 00:30 IST: FY 2026-27 April
    const e = await sellerEarnings(k.seller.id, 2026, new Date('2026-11-06T00:00:00Z'));
    expect(e.fy.label).toBe('2026-27');
    const m = Object.fromEntries(e.months.map((x) => [x.month, x]));
    expect(m['2026-04']).toMatchObject({ orders: 2, foodPaise: 30000 });
    expect(m['2026-05']).toMatchObject({ orders: 1, foodPaise: 10000 });
    expect(e.months).toHaveLength(12);
    expect(e.totals).toEqual({ foodPaise: 40000, orders: 3 });
    const prev = await sellerEarnings(k.seller.id, 2025, new Date('2026-11-06T00:00:00Z'));
    expect(prev.totals.orders).toBe(1);
    expect(fyStartOfYear(2026).toISOString()).toBe('2026-03-31T18:30:00.000Z');
  });

  test('acceptance counts declines and misses against the kitchen, not buyer cancels', async () => {
    const { sellerEarnings } = await import('@/lib/orders/earnings');
    const k = await makeLiveKitchen(db, { societyId, qty: 100 });
    const now = new Date();
    const buyer = await makeUser(db, 'buyer', { societyId });
    const mk = (status: string, accepted: boolean) => db.insert(s.orders).values({ buyerId: buyer.id, sellerId: k.seller.id, type: 'home_delivery', status: status as never, fulfillmentType: 'self_pickup', subtotalInPaise: 100, totalInPaise: 100, otpCode: '0000', bookedAt: now, acceptedAt: accepted ? now : null, cancelledAt: status.startsWith('cancel') ? now : null });
    await mk('completed', true);
    await mk('completed', true);
    await mk('cancelled_by_seller', false); // declined
    await mk('cancelled_auto', false); // missed
    await mk('cancelled_by_buyer', false); // not the kitchen's doing
    const e = await sellerEarnings(k.seller.id, undefined, now);
    expect(e.acceptance).toMatchObject({ accepted: 2, declined: 1, missed: 1, rate: 50 });
    expect(e.cancellations).toMatchObject({ seller_declined: 1, kitchen_missed: 1, buyer: 1, seller_cancelled: 0 });
  });

  test('routes: kitchen sees only its own sales; CSV export is correct and formula-safe', async () => {
    const k = await makeLiveKitchen(db, { societyId, qty: 100 });
    const other = await makeLiveKitchen(db, { societyId, qty: 100 });
    await completed(k, new Date());
    await completed(other, new Date());
    const { GET } = await import('@/app/api/seller/earnings/route');
    const { GET: CSV } = await import('@/app/api/seller/earnings/export/route');
    await loginAs(k.seller.id);
    const r = await call(GET, jsonReq('/api/seller/earnings', undefined, { method: 'GET' }));
    expect(r.status).toBe(200);
    expect((r.json.totals as { orders: number }).orders).toBe(1);
    const bad = await call(GET, new (await import('next/server')).NextRequest('http://localhost/api/seller/earnings?fy=1999'));
    expect(bad.status).toBe(400);
    const csv = await CSV(new (await import('next/server')).NextRequest('http://localhost/api/seller/earnings/export'), { params: Promise.resolve({}) } as never);
    const text = await csv.text();
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(text.split('\n')[0]).toBe('Order,Completed (IST date),Food amount (INR),Paid by,Payment reference (UTR)');
    expect(text).toContain('100.00,upi,123456789012');
    const { csvCell } = await import('@/lib/orders/earnings');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  test('the earnings page never says payout or settlement', () => {
    const src = readFileSync('src/app/seller/earnings/page.tsx', 'utf8').toLowerCase();
    expect(src).not.toMatch(/payout|settlement/);
    expect(src).toContain('tax-seller');
  });
});

describe('TDS export (A4)', () => {
  test('masked by default, full PAN only on request; both are audit-logged and need fresh 2FA', async () => {
    const { encryptPan } = await import('@/lib/pan');
    const { fyStartYear } = await import('@/lib/orders/earnings');
    const k = await makeLiveKitchen(db, { societyId, qty: 100, price: 20000 });
    await db.update(s.sellerProfiles).set({ panEnc: encryptPan('ABCDE1234F'), legalName: 'Kamala Cook' }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await completed(k, new Date(), 2);
    const admin = await makeUser(db, 'admin');
    process.env.ADMIN_EMAILS = admin.email!;
    const { GET } = await import('@/app/api/admin/exports/tds/route');
    const { NextRequest } = await import('next/server');
    await loginAs(admin.id, { mfa: false });
    const denied = await call(GET, new NextRequest('http://localhost/api/admin/exports/tds'));
    expect([401, 403]).toContain(denied.status);

    await loginAs(admin.id);
    const masked = await GET(new NextRequest(`http://localhost/api/admin/exports/tds?fy=${fyStartYear()}`), { params: Promise.resolve({}) } as never);
    const t1 = await masked.text();
    expect(t1).toContain('ABCDE****F');
    expect(t1).not.toContain('ABCDE1234F');
    expect(t1).toContain('Kamala Cook');
    expect(t1).toContain('400.00');
    const full = await GET(new NextRequest(`http://localhost/api/admin/exports/tds?fy=${fyStartYear()}&fullPan=1`), { params: Promise.resolve({}) } as never);
    expect(await full.text()).toContain('ABCDE1234F');
    const audits = (await db.select().from(s.auditLog)).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(['export.tds', 'export.tds.full_pan']));
  });
});
