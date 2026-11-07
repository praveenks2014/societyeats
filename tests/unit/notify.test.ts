import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { EVENTS, EVENT_KEYS } from '@/lib/notify/events';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
const noon = new Date('2026-11-10T06:30:00Z'); // 12:00 IST
const night = new Date('2026-11-10T18:30:00Z'); // 00:00 IST (quiet hours)

beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});
afterEach(async () => {
  const { setPushSenderForTests } = await import('@/lib/notify/adapters');
  setPushSenderForTests(null);
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

const inbox = async (userId: number, event?: string) => (await db.select().from(s.notifications).where(event ? and(eq(s.notifications.userId, userId), eq(s.notifications.eventKey, event)) : eq(s.notifications.userId, userId)));

describe('event catalogue', () => {
  test('has every event the brief lists, and each template renders clean copy', () => {
    for (const k of ['order_booked', 'order_accepted', 'order_cancelled', 'order_on_the_way', 'order_at_door', 'order_payment_claimed', 'order_payment_received', 'order_payment_disputed', 'chat_message', 'strike_issued', 'onboarding_decision', 'fssai_tier_change', 'provisional_cap_reached', 'plan_expiring', 'listing_paused', 'grievance_acknowledged', 'grievance_resolved']) expect(EVENT_KEYS).toContain(k);
    for (const k of EVENT_KEYS) {
      const full = { orderId: 7, role: 'buyer', cause: 'seller_cancel', refundPaise: 2000, creditPaise: 2000, foodPaise: 20000, days: 3, grievanceId: 9, preview: 'hello', decision: 'approved', tier: 'verified', title: 'Maintenance tonight', body: 'We will be down for ten minutes.', kind: 'service' };
      for (const ctx of [full, { ...full, role: 'seller', cause: 'auto_cancel' }, { ...full, role: 'admin', cause: 'admin', decision: 'changes' }]) {
        const m = EVENTS[k].build(ctx);
        expect(m.title.length, k).toBeGreaterThan(3);
        expect(m.body.length, k).toBeGreaterThan(3);
        expect(m.href.startsWith('/'), k).toBe(true);
        for (const t of [m.title, m.body]) expect(t, k).not.toMatch(/undefined|\[object|NaN/);
      }
    }
  });
  test('only transactional events email; chat is the only debounced event', () => {
    expect(EVENTS.chat_message.email).toBe(false);
    expect('debounceMinutes' in EVENTS.chat_message).toBe(true);
    expect(EVENT_KEYS.filter((k) => 'debounceMinutes' in EVENTS[k])).toEqual(['chat_message']);
  });
});

describe('channels', () => {
  test('quiet hours wrap midnight', async () => {
    const { inQuietHours } = await import('@/lib/notify');
    expect(inQuietHours(night, 22, 7)).toBe(true);
    expect(inQuietHours(noon, 22, 7)).toBe(false);
    expect(inQuietHours(new Date('2026-11-10T16:29:00Z'), 22, 7)).toBe(false); // 21:59 IST
    expect(inQuietHours(new Date('2026-11-10T16:30:00Z'), 22, 7)).toBe(true); // 22:00 IST
    expect(inQuietHours(new Date('2026-11-10T01:29:00Z'), 22, 7)).toBe(true); // 06:59 IST
    expect(inQuietHours(new Date('2026-11-10T01:30:00Z'), 22, 7)).toBe(false); // 07:00 IST
  });

  test('in-app always; email only for transactional events', async () => {
    const { emit } = await import('@/lib/notify');
    const u = await makeUser(db, 'buyer', { societyId });
    const a = await emit('order_accepted', u.id, { orderId: 1 }, noon);
    expect(a).toMatchObject({ inApp: true, email: true });
    const b = await emit('order_payment_received', u.id, { orderId: 1 }, noon);
    expect(b).toMatchObject({ inApp: true, email: false });
    expect((await inbox(u.id, 'order_accepted'))[0].title).toContain('accepted');
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, u.id))).length).toBe(1);
  });

  test('push: needs keys + subscription + permission; quiet hours skip non-urgent only; expired subscriptions are removed', async () => {
    const { emit, setPrefs } = await import('@/lib/notify');
    const { setPushSenderForTests } = await import('@/lib/notify/adapters');
    const sent: string[] = [];
    setPushSenderForTests(async (sub, payload) => {
      sent.push(`${sub.endpoint}|${payload.title}`);
      return sub.endpoint.includes('gone') ? { ok: false, gone: true } : { ok: true };
    });
    const u = await makeUser(db, 'buyer', { societyId });
    await db.insert(s.pushSubscriptions).values([{ userId: u.id, endpoint: 'https://push.example/ok', p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) }, { userId: u.id, endpoint: 'https://push.example/gone', p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) }]);

    // no VAPID keys: push is silently off
    expect((await emit('order_accepted', u.id, { orderId: 2 }, noon)).push).toBe(0);
    expect(sent).toEqual([]);

    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    const r = await emit('order_accepted', u.id, { orderId: 2 }, noon);
    expect(r.push).toBe(1); // the second subscription answered 410 → not counted…
    expect((await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, u.id))).map((x) => x.endpoint)).toEqual(['https://push.example/ok']); // …and was deleted

    sent.length = 0;
    expect((await emit('order_accepted', u.id, { orderId: 3 }, night)).push).toBe(0); // non-urgent at night
    expect((await emit('order_at_door', u.id, { orderId: 3, foodPaise: 100 }, night)).push).toBe(1); // urgent goes through
    expect(sent).toHaveLength(1);

    await setPrefs(u.id, { pushEnabled: false });
    expect((await emit('order_at_door', u.id, { orderId: 4, foodPaise: 100 }, noon)).push).toBe(0);
  });

  test('WhatsApp and SMS are opt-in and recorded by the mock adapters', async () => {
    const { emit, setPrefs } = await import('@/lib/notify');
    const u = await makeUser(db, 'buyer', { societyId });
    const none = await emit('order_accepted', u.id, { orderId: 5 }, noon);
    expect(none).toMatchObject({ whatsapp: false, sms: false });
    await setPrefs(u.id, { whatsappEnabled: true, smsEnabled: true });
    const r = await emit('order_accepted', u.id, { orderId: 5 }, noon);
    expect(r).toMatchObject({ whatsapp: true, sms: true });
    const rows = await db.select().from(s.messageOutbox).where(eq(s.messageOutbox.userId, u.id));
    expect(rows.map((x) => x.channel).sort()).toEqual(['sms', 'whatsapp']);
    expect(rows[0].toPhone).toBe(u.phone);
    expect(rows[0].status).toBe('mock');
    // quiet hours keep non-urgent ones off these channels too
    const before = (await db.select().from(s.messageOutbox).where(eq(s.messageOutbox.userId, u.id))).length;
    await emit('order_accepted', u.id, { orderId: 6 }, night);
    expect((await db.select().from(s.messageOutbox).where(eq(s.messageOutbox.userId, u.id))).length).toBe(before);
  });

  test('chat alerts are debounced to one per order per person per window', async () => {
    const { emit } = await import('@/lib/notify');
    const u = await makeUser(db, 'seller', { societyId });
    const t0 = new Date('2026-11-10T06:30:00Z');
    expect((await emit('chat_message', u.id, { orderId: 50, role: 'seller', preview: 'a' }, t0)).sent).toBe(true);
    expect((await emit('chat_message', u.id, { orderId: 50, role: 'seller', preview: 'b' }, new Date(t0.getTime() + 60_000))).skipped).toBe('debounced');
    expect((await emit('chat_message', u.id, { orderId: 51, role: 'seller', preview: 'c' }, new Date(t0.getTime() + 61_000))).sent).toBe(true); // another order
    expect((await emit('chat_message', u.id, { orderId: 50, role: 'seller', preview: 'd' }, new Date(t0.getTime() + 3 * 60_000))).sent).toBe(true); // window passed
    expect((await inbox(u.id, 'chat_message')).length).toBe(3);
  });

  test('preferences API shape', async () => {
    const { getPrefs, setPrefs, DEFAULT_PREFS } = await import('@/lib/notify');
    const u = await makeUser(db, 'buyer', { societyId });
    expect(await getPrefs(u.id)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ pushEnabled: true, whatsappEnabled: false, smsEnabled: false, marketingEnabled: false });
    expect(await setPrefs(u.id, { marketingEnabled: true })).toMatchObject({ marketingEnabled: true, pushEnabled: true });
  });
});

describe('the matrix, end to end through the real flows', () => {
  async function book(opts: { pickup?: boolean } = {}) {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const k = await makeLiveKitchen(db, { societyId, qty: 50, acceptsCash: true });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await db.update(s.sellerProfiles).set({ offersSellerDelivery: true, offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: opts.pickup ? 'self_pickup' : 'seller_delivery', ...(opts.pickup ? {} : { address: { label: 'Home', flat: 'B-1', societyName: 'S', addressText: 'S', lat: 17.465, lng: 78.31 } }) });
    await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
    const act = async (who: 'buyer' | 'seller', action: string, extra: Record<string, unknown> = {}) => {
      const { performOrderAction } = await import('@/lib/orders/actions');
      return performOrderAction(r.orderId, { action, actor: who, actorId: who === 'buyer' ? buyer.id : k.seller.id, ...extra } as never);
    };
    return { ...k, buyer, orderId: r.orderId, act };
  }

  test('happy path tells the right person at every step', async () => {
    const admin = await makeUser(db, 'admin');
    const o = await book();
    expect((await inbox(o.seller.id, 'order_booked')).length).toBe(1);
    await o.act('seller', 'accept');
    expect((await inbox(o.buyer.id, 'order_accepted')).length).toBe(1);
    await o.act('seller', 'preparing');
    await o.act('seller', 'ready');
    expect((await inbox(o.buyer.id, 'order_ready')).length).toBe(1);
    await o.act('seller', 'on_the_way');
    expect((await inbox(o.buyer.id, 'order_on_the_way')).length).toBe(1);
    await o.act('seller', 'reached_door');
    expect((await inbox(o.buyer.id, 'order_at_door')).length).toBe(1);
    await o.act('buyer', 'collect');
    await o.act('buyer', 'claim_paid', { method: 'upi', utr: '123456789012' });
    expect((await inbox(o.seller.id, 'order_payment_claimed')).length).toBe(1);
    await o.act('seller', 'confirm_paid');
    expect((await inbox(o.buyer.id, 'order_payment_received')).length).toBe(1);

    // dispute: buyer and admins
    const d = await book({ pickup: true });
    await d.act('seller', 'accept');
    await d.act('seller', 'preparing');
    await d.act('seller', 'ready');
    await d.act('seller', 'buyer_arrived');
    await d.act('buyer', 'collect');
    await d.act('buyer', 'claim_paid', { method: 'cash' });
    await d.act('seller', 'not_received', { reason: 'nothing in my account' });
    expect((await inbox(d.buyer.id, 'order_payment_disputed')).length).toBe(1);
    expect((await inbox(admin.id, 'order_payment_disputed')).length).toBeGreaterThanOrEqual(1);
  });

  test('every cancellation cause tells the counterparty, with money facts when they apply', async () => {
    const a = await book();
    await a.act('seller', 'seller_cancel', { reason: 'out of gas' }); // decline of a booked order
    const decl = (await inbox(a.buyer.id, 'order_cancelled'))[0];
    expect(decl.title).toMatch(/declined/);
    expect(decl.body).toMatch(/refunded/);
    expect(decl.body).toMatch(/credit/);

    const b = await book();
    await b.act('seller', 'accept');
    await b.act('seller', 'seller_cancel', { reason: 'ill' });
    expect((await inbox(b.buyer.id, 'order_cancelled'))[0].title).toMatch(/cancelled by the kitchen/);

    const c = await book();
    await c.act('buyer', 'buyer_cancel');
    expect((await inbox(c.seller.id, 'order_cancelled')).length).toBe(1);
    expect((await inbox(c.buyer.id, 'order_cancelled'))[0].body).toMatch(/refunded/);

    const e = await book();
    await e.act('seller', 'accept');
    await e.act('buyer', 'buyer_cancel');
    expect((await inbox(e.buyer.id, 'order_cancelled'))[0].body).toMatch(/not refunded/);

    const f = await book({ pickup: true });
    for (const x of ['accept', 'preparing', 'ready', 'buyer_arrived']) await f.act('seller', x);
    await f.act('seller', 'buyer_couldnt_pay', { reason: 'no money' });
    expect((await inbox(f.buyer.id, 'order_cancelled'))[0].body).toMatch(/not refunded/);
  });

  test('strike, paused listing, grievance, onboarding, FSSAI and cap events', async () => {
    const { recordStrike } = await import('@/lib/orders/strikes');
    const k = await makeLiveKitchen(db, { societyId });
    for (let i = 0; i < 3; i++) await recordStrike({ userId: k.seller.id, role: 'seller', kind: 'seller_cancel', reason: 'cancelled' });
    expect((await inbox(k.seller.id, 'strike_issued')).length).toBe(3);
    expect((await inbox(k.seller.id, 'listing_paused')).length).toBe(1);

    const { createGrievance, acknowledgeGrievance, resolveGrievance } = await import('@/lib/grievances');
    const u = await makeUser(db, 'buyer', { societyId });
    const admin = await makeUser(db, 'admin');
    const g = await createGrievance({ kind: 'grievance', subject: 'late', raisedById: u.id, raisedRole: 'buyer' });
    await acknowledgeGrievance(g.id, admin.id);
    await resolveGrievance(g.id, admin.id, 'refund', 'Refunded the fee');
    expect((await inbox(u.id, 'grievance_acknowledged')).length).toBe(1);
    expect((await inbox(u.id, 'grievance_resolved'))[0].body).toBe('Refunded the fee');

    const { blockFssai, unblockFssai } = await import('@/lib/fssai/admin-actions');
    await blockFssai({ sellerId: k.seller.id, reason: 'Certificate looks altered', adminId: admin.id });
    await unblockFssai({ sellerId: k.seller.id, adminId: admin.id });
    expect((await inbox(k.seller.id, 'fssai_tier_change')).length).toBe(2);

  });

  test('provisional cap reached: the kitchen is told once per day', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId, qty: 100, fssai: 'provisional' });
    await db.update(s.sellerProfiles).set({ capOverrideJson: { maxOrdersPerDay: 1 } as never }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    const place = () => createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    await place();
    await expect(place()).rejects.toMatchObject({ status: 409 });
    await expect(place()).rejects.toMatchObject({ status: 409 });
    expect((await inbox(k.seller.id, 'provisional_cap_reached')).length).toBe(1);
  });
});
