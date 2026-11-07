import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
const DAY = 86_400_000;

beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

async function closedOrder(daysAgo: number, status: 'completed' | 'cancelled_by_buyer' = 'completed') {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const k = await makeLiveKitchen(db, { societyId, qty: 50 });
  const buyer = await makeUser(db, 'buyer', { societyId });
  const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
  const when = new Date(Date.now() - daysAgo * DAY);
  await db.update(s.orders).set({ status, completedAt: status === 'completed' ? when : null, cancelledAt: status === 'completed' ? null : when }).where(eq(s.orders.id, r.orderId));
  await db.insert(s.orderMessages).values([{ orderId: r.orderId, senderId: buyer.id, senderRole: 'buyer', body: 'hello' }, { orderId: r.orderId, senderId: k.seller.id, senderRole: 'seller', body: 'hi' }]);
  return { orderId: r.orderId, buyer, seller: k.seller };
}
const msgCount = async (orderId: number) => (await db.select().from(s.orderMessages).where(eq(s.orderMessages.orderId, orderId))).length;

describe('retention', () => {
  test('chats are purged 180 days after closure — not before, not while a dispute is open', async () => {
    const { runRetention } = await import('@/lib/retention');
    const old = await closedOrder(200);
    const oldCancelled = await closedOrder(200, 'cancelled_by_buyer');
    const recent = await closedOrder(170);
    const disputed = await closedOrder(200);
    await db.insert(s.grievances).values({ kind: 'dispute_payment', orderId: disputed.orderId, subject: 'x', ackDueAt: new Date(), resolveDueAt: new Date() });

    const r = await runRetention();
    expect(r.chatMessages).toBe(4);
    expect(await msgCount(old.orderId)).toBe(0);
    expect(await msgCount(oldCancelled.orderId)).toBe(0);
    expect(await msgCount(recent.orderId)).toBe(2);
    expect(await msgCount(disputed.orderId)).toBe(2);

    // once the dispute is resolved the next pass removes it; and 170 → 181 days
    await db.update(s.grievances).set({ status: 'resolved' }).where(eq(s.grievances.orderId, disputed.orderId));
    await runRetention();
    expect(await msgCount(disputed.orderId)).toBe(0);
    await runRetention(new Date(Date.now() + 12 * DAY));
    expect(await msgCount(recent.orderId)).toBe(0);
  });

  test('verification screenshots after 180 days; pending reviews keep theirs; login codes after 24 hours', async () => {
    const { runRetention } = await import('@/lib/retention');
    const { setStorageForTests } = await import('@/lib/storage');
    const { MemoryStorage } = await import('@/lib/storage/memory');
    const store = new MemoryStorage();
    setStorageForTests(store);
    await store.put('ev-old.png', Buffer.from('x'));
    await store.put('ev-pending.png', Buffer.from('x'));
    const seller = await makeUser(db, 'seller', { societyId });
    const old = new Date(Date.now() - 200 * DAY);
    const [a] = await db.insert(s.upiVerifications).values({ sellerId: seller.id, provider: 'mock', status: 'verified', claimedVpa: 'a@b', evidenceFileKey: 'ev-old.png', createdAt: old, completedAt: old }).returning();
    const [b] = await db.insert(s.upiVerifications).values({ sellerId: seller.id, provider: 'mock', status: 'needs_manual_review', claimedVpa: 'a@b', evidenceFileKey: 'ev-pending.png', createdAt: old }).returning();
    await db.insert(s.loginCodes).values([{ email: 'old@x.in', codeHash: 'h', expiresAt: new Date(), createdAt: new Date(Date.now() - 30 * 3_600_000) }, { email: 'new@x.in', codeHash: 'h', expiresAt: new Date(Date.now() + 600_000) }]);

    const r = await runRetention();
    expect(r.verificationScreenshots).toBe(1);
    expect(r.loginCodes).toBe(1);
    expect(await store.get('ev-old.png')).toBeNull();
    expect(await store.get('ev-pending.png')).not.toBeNull();
    expect((await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.id, a.id)))[0].evidenceFileKey).toBeNull();
    expect((await db.select().from(s.upiVerifications).where(eq(s.upiVerifications.id, b.id)))[0].evidenceFileKey).toBe('ev-pending.png');
    expect((await db.select().from(s.loginCodes)).map((c) => c.email)).toEqual(['new@x.in']);
    setStorageForTests(undefined);
  });

  test('the audit log is protected for at least a year', async () => {
    const { purgeableAuditCutoff } = await import('@/lib/retention');
    const cut = await purgeableAuditCutoff();
    expect(Date.now() - cut.getTime()).toBeGreaterThanOrEqual(365 * DAY - 1000);
  });
});
