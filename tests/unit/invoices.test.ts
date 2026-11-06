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

async function placed(price = 20000, qty = 1) {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const { markOrderPaid } = await import('@/lib/payments');
  const k = await makeLiveKitchen(db, { societyId, qty: 50, price });
  const buyer = await makeUser(db, 'buyer', { societyId });
  const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty }], fulfillmentType: 'self_pickup' });
  await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
  return { ...k, buyer, orderId: r.orderId };
}
const complete = (id: number) => db.update(s.orders).set({ status: 'completed', completedAt: new Date(), foodPaymentMethod: 'upi', foodPaymentUtr: '987654321098', foodPaymentStatus: 'confirmed' }).where(eq(s.orders.id, id));

describe('invoice numbering', () => {
  test('sequential, gap-free and exactly-once under concurrency; a new financial year restarts at 1', async () => {
    const { ensureInvoiceNumber, formatInvoiceNumber } = await import('@/lib/invoices/order-invoice');
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push((await placed()).orderId);
    const now = new Date('2026-11-06T10:00:00Z');
    const nums = await Promise.all(ids.map((id) => ensureInvoiceNumber(id, now)));
    expect(new Set(nums).size).toBe(6);
    const serials = nums.map((n) => Number(n.split('/')[2])).sort((a, b) => a - b);
    expect(serials).toEqual([1, 2, 3, 4, 5, 6]);
    expect(nums.every((n) => n.startsWith('PP/2026-27/'))).toBe(true);
    // idempotent: asking again returns the same number and does not consume another
    expect(await ensureInvoiceNumber(ids[0], now)).toBe(nums[0]);
    const next = (await placed()).orderId;
    expect(await ensureInvoiceNumber(next, now)).toBe('PP/2026-27/000007');
    // 1 April 2027 IST starts FY 2027-28 at 1
    const apr = (await placed()).orderId;
    expect(await ensureInvoiceNumber(apr, new Date('2027-03-31T19:00:00Z'))).toBe('PP/2027-28/000001');
    expect(formatInvoiceNumber('2026-27', 42)).toBe('PP/2026-27/000042');
    await expect(ensureInvoiceNumber(99999999, now)).rejects.toThrow();
  });

  test('the number is issued when the order completes through the real action path', async () => {
    const { performOrderAction } = await import('@/lib/orders/actions');
    const o = await placed();
    const run = (who: 'seller' | 'buyer', action: string, extra: Record<string, unknown> = {}) => performOrderAction(o.orderId, { action, actor: who, actorId: who === 'seller' ? o.seller.id : o.buyer.id, ...extra } as never);
    await run('seller', 'accept');
    await run('seller', 'preparing');
    await run('seller', 'ready');
    await run('seller', 'buyer_arrived');
    await run('buyer', 'collect');
    await run('buyer', 'claim_paid', { method: 'upi', utr: '123456789012' });
    expect((await db.select().from(s.orders).where(eq(s.orders.id, o.orderId)))[0].invoiceNumber).toBeNull();
    await run('seller', 'confirm_paid');
    expect((await db.select().from(s.orders).where(eq(s.orders.id, o.orderId)))[0].invoiceNumber).toMatch(/^PP\/\d{4}-\d{2}\/\d{6}$/);
  });

  test('a fully refunded fee earns nothing, so no invoice is due', async () => {
    const { invoiceDue } = await import('@/lib/invoices/order-invoice');
    expect(invoiceDue({ onlineChargeInPaise: 2000, feeRefundedInPaise: 2000, status: 'cancelled_auto' })).toBe(false);
    expect(invoiceDue({ onlineChargeInPaise: 2000, feeRefundedInPaise: 0, status: 'cancelled_by_buyer' })).toBe(true);
    expect(invoiceDue({ onlineChargeInPaise: 0, feeRefundedInPaise: 0, status: 'completed' })).toBe(false);
    expect(invoiceDue({ onlineChargeInPaise: 2000, feeRefundedInPaise: 0, status: 'booked' })).toBe(false);
  });
});

describe('two-part invoice for every GST mode', () => {
  async function invoice(orderId: number, userId: number) {
    const { GET } = await import('@/app/api/orders/[id]/invoice/route');
    await loginAs(userId);
    return call(GET, jsonReq(`/api/orders/${orderId}/invoice`, undefined, { method: 'GET' }), { id: String(orderId) });
  }

  test.each([
    ['unregistered', 0, 0],
    ['registered_fee_only', 360, 0],
    ['registered_eco_9_5', 360, 1000],
  ])('%s: fee GST %i, food GST %i', async (mode, feeGst, ecoGst) => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('platformGstin', '36ABCDE1234F1Z5');
    await setPlatformSetting('gstMode', mode);
    const o = await placed(20000, 1);
    await complete(o.orderId);
    const r = await invoice(o.orderId, o.buyer.id);
    expect(r.status).toBe(200);
    const j = r.json as { invoiceNumber: string; isTaxInvoice: boolean; order: { platformFeeInPaise: number; feeGstInPaise: number; ecoGstInPaise: number; onlineChargeInPaise: number; foodTotalInPaise: number }; foodBill: { issuedBy: string; paidDirectly: boolean; method: string; utr: string; fssaiLabel: string | null } };
    expect(j.invoiceNumber).toMatch(/^PP\/\d{4}-\d{2}\/\d{6}$/);
    expect(j.order.platformFeeInPaise).toBe(2000);
    expect(j.order.feeGstInPaise).toBe(feeGst);
    expect(j.order.ecoGstInPaise).toBe(ecoGst);
    expect(j.order.onlineChargeInPaise).toBe(2000 + feeGst + ecoGst);
    expect(j.isTaxInvoice).toBe(feeGst + ecoGst > 0);
    // part 2 is the kitchen's food bill: kitchen name, FSSAI label, paid directly with the UTR
    expect(j.foodBill).toMatchObject({ issuedBy: `Kitchen ${o.seller.id}`, paidDirectly: true, method: 'upi', utr: '987654321098' });
    expect(j.foodBill.fssaiLabel).toMatch(/^FSSAI (registered|applied)/);
    expect(j.order.foodTotalInPaise).toBe(20000);
    // a second look returns the same number
    expect(((await invoice(o.orderId, o.buyer.id)).json as { invoiceNumber: string }).invoiceNumber).toBe(j.invoiceNumber);
    await setPlatformSetting('gstMode', 'unregistered');
  });

  test('an unrelated user cannot read it', async () => {
    const o = await placed();
    const other = await makeUser(db, 'buyer', { societyId });
    expect((await invoice(o.orderId, other.id)).status).toBe(403);
  });

  test('the receipt page renders both parts, the paid-directly line and the consume-by disclaimer', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/orders/[id]/invoice/invoice-client.tsx', 'utf8');
    expect(src).toContain('PART 1');
    expect(src).toContain('PART 2');
    expect(src).toContain('Paid directly to the kitchen');
    expect(src).toMatch(/<DisclaimerClient id="consume-by"/);
  });
});
