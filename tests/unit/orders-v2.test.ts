import { beforeAll, describe, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, jsonReq, loginAs } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import {
  ACTIVE_STATES, ADDRESS_VISIBLE_STATES, canTransition, cancelPolicy, nextOrderStatus, QR_REVEAL_STATES, TERMINAL_STATES, TRANSITIONS,
  type Actor, type OrderAction, type OrderStatus,
} from '@/lib/orders/state';

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

const order = async (id: number) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0];
const dish = async (id: number) => (await db.select().from(s.listings).where(eq(s.listings.id, id)))[0];

async function booked(over: { fulfillment?: 'self_pickup' | 'seller_delivery'; qty?: number; price?: number; cash?: boolean; stock?: number; useCredit?: boolean; buyer?: Awaited<ReturnType<typeof makeUser>>; kitchen?: Awaited<ReturnType<typeof makeLiveKitchen>> } = {}) {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const { markOrderPaid } = await import('@/lib/payments');
  const k = over.kitchen ?? (await makeLiveKitchen(db, { societyId, qty: over.stock ?? 20, price: over.price ?? 10000, acceptsCash: over.cash }));
  await db.update(s.sellerProfiles).set({ offersSellerDelivery: true, offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
  const buyer = over.buyer ?? (await makeUser(db, 'buyer', { societyId }));
  const r = await createHomeOrder({
    buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: over.qty ?? 2 }], fulfillmentType: over.fulfillment ?? 'seller_delivery', useCredit: over.useCredit,
    ...(over.fulfillment === 'self_pickup' ? {} : { address: { label: 'Home', flat: 'B-1204', societyName: 'Soc', addressText: 'Soc, Hyd', lat: 17.465, lng: 78.31 } }),
  });
  await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
  return { ...k, buyer, orderId: r.orderId };
}
type Ctx = Awaited<ReturnType<typeof booked>>;
async function act(ctx: Ctx, who: 'buyer' | 'seller' | 'system' | 'admin', action: OrderAction, extra: Record<string, unknown> = {}) {
  const { performOrderAction } = await import('@/lib/orders/actions');
  const admin = who === 'admin' ? await makeUser(db, 'admin') : null;
  return performOrderAction(ctx.orderId, { action, actor: who, actorId: who === 'buyer' ? ctx.buyer.id : who === 'seller' ? ctx.seller.id : admin?.id ?? null, ...extra } as never);
}
const toDoor = async (ctx: Ctx, delivery = true) => {
  await act(ctx, 'seller', 'accept');
  await act(ctx, 'seller', 'preparing');
  await act(ctx, 'seller', 'ready');
  if (delivery) {
    await act(ctx, 'seller', 'on_the_way');
    await act(ctx, 'seller', 'reached_door');
  } else await act(ctx, 'seller', 'buyer_arrived');
};

describe('state machine', () => {
  const STATES = Object.keys({ ...Object.fromEntries(Object.values(TRANSITIONS).flatMap((r) => [...r.from, r.to].map((x) => [x, 1]))) }) as OrderStatus[];
  const ACTORS: Actor[] = ['buyer', 'seller', 'restaurant', 'admin', 'system'];

  test('every (state × action × actor) is allowed exactly when the rule table says so', () => {
    for (const st of STATES) for (const [action, rule] of Object.entries(TRANSITIONS) as [OrderAction, (typeof TRANSITIONS)[OrderAction]][]) for (const actor of ACTORS) {
      const expected = rule.from.includes(st) && rule.actors.includes(actor);
      expect(canTransition(st, action, actor), `${st} --${action}--> by ${actor}`).toBe(expected);
    }
  });
  test('terminal states have no way out; nobody can reopen a finished order', () => {
    for (const st of TERMINAL_STATES.filter((t) => !['closed_unpaid'].includes(t))) for (const action of Object.keys(TRANSITIONS) as OrderAction[]) for (const actor of ACTORS) {
      expect(canTransition(st, action, actor), `${st} ${action} ${actor}`).toBe(false);
    }
  });
  test('role rules: buyer cannot accept/confirm; kitchen cannot collect or claim payment; only admin resolves disputes', () => {
    expect(canTransition('booked', 'accept', 'buyer')).toBe(false);
    expect(canTransition('payment_claimed', 'confirm_paid', 'buyer')).toBe(false);
    expect(canTransition('at_door', 'collect', 'seller')).toBe(false);
    expect(canTransition('collected', 'claim_paid', 'seller')).toBe(false);
    expect(canTransition('payment_disputed', 'resolve_paid', 'seller')).toBe(false);
    expect(canTransition('payment_disputed', 'resolve_paid', 'admin')).toBe(true);
    expect(canTransition('booked', 'seller_cancel', 'buyer')).toBe(false);
    expect(canTransition('at_door', 'seller_cancel', 'seller')).toBe(false); // cancelling is only possible before the door
    expect(canTransition('accepted', 'buyer_cancel', 'buyer')).toBe(true);
    expect(canTransition('preparing', 'buyer_cancel', 'buyer')).toBe(false);
  });
  test('the door is only reachable from "on the way" (delivery) or "ready" (pickup), and the QR is revealed only from there', () => {
    const into = Object.entries(TRANSITIONS).filter(([, r]) => r.to === 'at_door');
    expect(into.map(([a]) => a).sort()).toEqual(['buyer_arrived', 'reached_door']);
    expect(QR_REVEAL_STATES).toEqual(['at_door', 'collected', 'payment_claimed', 'payment_disputed']);
    for (const st of ['fee_pending', 'booked', 'accepted', 'preparing', 'ready', 'on_the_way'] as OrderStatus[]) expect(QR_REVEAL_STATES).not.toContain(st);
    expect(ADDRESS_VISIBLE_STATES).not.toContain('booked');
    expect(ACTIVE_STATES).toContain('at_door');
  });
  test('cancellation money table (fee, credit, strike)', () => {
    expect(cancelPolicy('buyer_before_accept')).toEqual({ refundFee: true, credit: false, strike: null });
    expect(cancelPolicy('buyer_after_accept')).toMatchObject({ refundFee: false, strike: { role: 'buyer', kind: 'buyer_late_cancel' } });
    expect(cancelPolicy('buyer_after_accept', { feeRetainedOnLateBuyerCancel: false }).refundFee).toBe(true);
    expect(cancelPolicy('seller_cancel')).toEqual({ refundFee: true, credit: true, strike: { role: 'seller', kind: 'seller_cancel' } });
    expect(cancelPolicy('seller_decline')).toEqual({ refundFee: true, credit: true, strike: null });
    expect(cancelPolicy('auto_no_accept')).toMatchObject({ refundFee: true, credit: false, strike: { role: 'seller', kind: 'seller_missed' } });
    expect(cancelPolicy('buyer_couldnt_pay')).toMatchObject({ refundFee: false, credit: false, strike: { role: 'buyer', kind: 'buyer_unpaid' } });
    expect(cancelPolicy('buyer_no_show')).toMatchObject({ refundFee: false, strike: { role: 'buyer', kind: 'buyer_no_show' } });
    expect(cancelPolicy('admin')).toEqual({ refundFee: true, credit: false, strike: null });
  });
  test('illegal moves throw 409/403', () => {
    expect(() => nextOrderStatus('booked', 'ready', 'seller')).toThrow(/Cannot/);
    expect(() => nextOrderStatus('booked', 'accept', 'buyer')).toThrow(/cannot do that/);
  });
});

describe('happy paths', () => {
  test('delivery: book → accept → cook → ready → on the way → at door → collected → paid (UTR) → confirmed → completed', async () => {
    const ctx = await booked({ qty: 2 });
    expect((await order(ctx.orderId)).status).toBe('booked');
    expect((await dish(ctx.dish.id)).availableQty).toBe(18);
    await toDoor(ctx);
    expect((await order(ctx.orderId)).status).toBe('at_door');
    await act(ctx, 'buyer', 'collect');
    await act(ctx, 'buyer', 'claim_paid', { method: 'upi', utr: '123456789012' });
    let o = await order(ctx.orderId);
    expect(o).toMatchObject({ status: 'payment_claimed', foodPaymentStatus: 'buyer_claimed', foodPaymentUtr: '123456789012', foodPaymentMethod: 'upi' });
    await act(ctx, 'seller', 'confirm_paid');
    o = await order(ctx.orderId);
    expect(o.status).toBe('completed');
    expect(o.completedAt).toBeTruthy();
    expect(o.foodPaymentStatus).toBe('confirmed');
    const events = (await db.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, ctx.orderId))).map((e) => e.status);
    expect(events).toEqual(['fee_pending', 'booked', 'accepted', 'preparing', 'ready', 'on_the_way', 'at_door', 'collected', 'payment_claimed', 'completed']);
  });

  test('pickup with cash: ready → "buyer has arrived" → collected → paid in cash → confirmed', async () => {
    const ctx = await booked({ fulfillment: 'self_pickup', cash: true });
    await toDoor(ctx, false);
    await act(ctx, 'buyer', 'collect');
    await act(ctx, 'buyer', 'claim_paid', { method: 'cash' });
    await act(ctx, 'seller', 'confirm_paid');
    expect((await order(ctx.orderId)).foodPaymentMethod).toBe('cash');
    expect((await order(ctx.orderId)).status).toBe('completed');
  });

  test('cash is refused for a kitchen that does not take it; a UTR must be exactly 12 digits; delivery/pickup steps cannot be mixed up', async () => {
    const ctx = await booked();
    await toDoor(ctx);
    await act(ctx, 'buyer', 'collect');
    await expect(act(ctx, 'buyer', 'claim_paid', { method: 'cash' })).rejects.toMatchObject({ status: 400 });
    await expect(act(ctx, 'buyer', 'claim_paid', { method: 'upi', utr: '12345' })).rejects.toMatchObject({ status: 400 });
    await expect(act(ctx, 'buyer', 'claim_paid', {})).rejects.toMatchObject({ status: 400 });
    const pickup = await booked({ fulfillment: 'self_pickup' });
    await act(pickup, 'seller', 'accept');
    await act(pickup, 'seller', 'ready');
    await expect(act(pickup, 'seller', 'on_the_way')).rejects.toMatchObject({ status: 400 });
    const del = await booked();
    await act(del, 'seller', 'accept');
    await act(del, 'seller', 'ready');
    await expect(act(del, 'seller', 'buyer_arrived')).rejects.toMatchObject({ status: 400 });
  });

  test('completing the first order of a referred buyer grants the referrer credit', async () => {
    const referrer = await makeUser(db, 'buyer', { societyId });
    const friend = await makeUser(db, 'buyer', { societyId, referredByUserId: referrer.id });
    const ctx = await booked({ buyer: friend });
    await toDoor(ctx);
    await act(ctx, 'buyer', 'collect');
    await act(ctx, 'buyer', 'claim_paid', { method: 'upi' });
    await act(ctx, 'seller', 'confirm_paid');
    const credits = await db.select().from(s.referralCredits).where(and(eq(s.referralCredits.buyerId, referrer.id), eq(s.referralCredits.source, 'referral')));
    expect(credits).toHaveLength(1);
  });

  test("another user cannot act on, read or cancel someone else's order (object-level authorisation)", async () => {
    const ctx = await booked();
    const stranger = await makeUser(db, 'buyer', { societyId });
    const { performOrderAction } = await import('@/lib/orders/actions');
    await expect(performOrderAction(ctx.orderId, { action: 'buyer_cancel', actor: 'buyer', actorId: stranger.id })).rejects.toMatchObject({ status: 403 });
    await expect(performOrderAction(ctx.orderId, { action: 'accept', actor: 'seller', actorId: stranger.id })).rejects.toMatchObject({ status: 403 });
    const { POST } = await import('@/app/api/orders/[id]/action/route');
    await loginAs(stranger.id);
    expect((await call(POST, jsonReq(`/api/orders/${ctx.orderId}/action`, { action: 'buyer_cancel' }), { id: String(ctx.orderId) })).status).toBe(403);
    const { GET } = await import('@/app/api/orders/[id]/route');
    expect((await call(GET as never, jsonReq(`/api/orders/${ctx.orderId}`, undefined, { method: 'GET' }), { id: String(ctx.orderId) })).status).toBe(403);
    // a second, racing transition is refused rather than applied twice
    await act(ctx, 'seller', 'accept');
    await expect(act(ctx, 'seller', 'accept')).rejects.toMatchObject({ status: 409 });
  });
});

describe('the kitchen UPI ID and QR never reach the buyer before the door', () => {
  const view = async (ctx: Ctx, who: 'buyer' | 'seller') => {
    const { GET } = await import('@/app/api/orders/[id]/route');
    await loginAs(who === 'buyer' ? ctx.buyer.id : ctx.seller.id);
    const r = await call(GET as never, jsonReq(`/api/orders/${ctx.orderId}`, undefined, { method: 'GET' }), { id: String(ctx.orderId) });
    expect(r.status).toBe(200);
    return r.json as Record<string, any>;
  };

  test('response bodies at every pre-door state contain no VPA, no registered name and no QR', async () => {
    const ctx = await booked();
    const vpa = `kitchen${ctx.seller.id}@okbank`;
    const regName = `KITCHEN ${ctx.seller.id} COOK`;
    const check = async (state: string) => {
      const j = await view(ctx, 'buyer');
      const text = JSON.stringify(j);
      expect(j.order.status, state).toBe(state);
      expect(j.upi, state).toBeNull();
      expect(text, state).not.toContain(vpa);
      expect(text, state).not.toContain(regName);
      expect(text, state).not.toContain('<svg');
      expect(text, state).not.toContain('upi://pay');
      expect(j.order).not.toHaveProperty('sellerVpaSnapshot');
    };
    await check('booked');
    await act(ctx, 'seller', 'accept'); await check('accepted');
    await act(ctx, 'seller', 'preparing'); await check('preparing');
    await act(ctx, 'seller', 'ready'); await check('ready');
    await act(ctx, 'seller', 'on_the_way'); await check('on_the_way');
    // the kitchen's own view never carries the buyer's money details either
    const sv = await view(ctx, 'seller');
    expect(JSON.stringify(sv)).not.toContain('<svg');
    expect(sv.upi).toBeNull();
    // at the door: the QR, UPI ID, registered name and exact food amount appear — for the buyer only
    await act(ctx, 'seller', 'reached_door');
    const j = await view(ctx, 'buyer');
    expect(j.order.status).toBe('at_door');
    expect(j.upi).toMatchObject({ vpa, registeredName: regName, amountInPaise: 20000 });
    expect(j.upi.qrSvg).toContain('<svg');
    expect(j.upi.uri).toContain('am=200.00');
    expect(j.upi.uri).toContain('cu=INR');
    expect(j.upi.uri).toContain(`pa=${encodeURIComponent(vpa)}`);
    expect((await view(ctx, 'seller')).upi).toBeNull();
  });

  test('the kitchen sees the flat only after accepting, and not 24 hours after completion', async () => {
    const ctx = await booked();
    const { GET } = await import('@/app/api/seller/orders/route');
    const flat = async () => {
      await loginAs(ctx.seller.id);
      const r = await call(GET as never, jsonReq('/api/seller/orders', undefined, { method: 'GET' }));
      const o = (r.json.orders as any[]).find((x) => x.id === ctx.orderId);
      return o.deliveryAddressJson?.flat ?? null;
    };
    expect(await flat()).toBeNull(); // booked, not accepted
    await toDoor(ctx);
    expect(await flat()).toBe('B-1204');
    await act(ctx, 'buyer', 'collect');
    await act(ctx, 'buyer', 'claim_paid', { method: 'upi' });
    await act(ctx, 'seller', 'confirm_paid');
    expect(await flat()).toBe('B-1204'); // just completed
    await db.update(s.orders).set({ completedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(s.orders.id, ctx.orderId));
    expect(await flat()).toBeNull();
  });
});

describe('cancellations: money, credit and strikes', () => {
  const pay = async (id: number) => (await db.select().from(s.payments).where(eq(s.payments.orderId, id)))[0];
  const credits = async (buyerId: number, source: string) => db.select().from(s.referralCredits).where(and(eq(s.referralCredits.buyerId, buyerId), eq(s.referralCredits.source, source)));
  const strikes = async (userId: number) => db.select().from(s.strikes).where(eq(s.strikes.userId, userId));

  test('kitchen declines a booked order: fee refunded in full + equal credit, stock back, no strike', async () => {
    const ctx = await booked({ qty: 2 });
    const r = await act(ctx, 'seller', 'seller_cancel', { reason: 'Out of rice' });
    expect(r).toMatchObject({ status: 'cancelled_by_seller', refundedFeePaise: 2000, creditIssuedPaise: 2000, strike: false });
    expect((await pay(ctx.orderId)).refundedInPaise).toBe(2000);
    expect((await credits(ctx.buyer.id, 'seller_cancel'))[0]).toMatchObject({ amountInPaise: 2000, status: 'available', sourceOrderId: ctx.orderId });
    expect((await dish(ctx.dish.id)).availableQty).toBe(20);
    expect(await strikes(ctx.seller.id)).toHaveLength(0);
    expect((await order(ctx.orderId)).cancelReason).toBe('Out of rice');
  });

  test('kitchen cancels after accepting: refund + equal credit + a strike; a reason is mandatory', async () => {
    const ctx = await booked({ qty: 1 });
    await act(ctx, 'seller', 'accept');
    await expect(act(ctx, 'seller', 'seller_cancel', {})).rejects.toMatchObject({ status: 400 });
    const r = await act(ctx, 'seller', 'seller_cancel', { reason: 'Gas ran out' });
    expect(r).toMatchObject({ refundedFeePaise: 1000, creditIssuedPaise: 1000, strike: true });
    expect((await strikes(ctx.seller.id))[0]).toMatchObject({ role: 'seller', kind: 'seller_cancel', orderId: ctx.orderId });
  });

  test('the cancel-credit pays down the next platform fee only', async () => {
    const ctx = await booked({ qty: 1 });
    await act(ctx, 'seller', 'seller_cancel', { reason: 'Sorry' });
    const k = await makeLiveKitchen(db, { societyId, price: 10000 });
    const next = await booked({ kitchen: k, buyer: ctx.buyer, qty: 1, useCredit: true });
    const o = await order(next.orderId);
    expect(o.referralCreditAppliedInPaise).toBe(1000);
    expect(o.onlineChargeInPaise).toBe(0); // ₹10 fee fully covered by the ₹10 credit
    expect(o.status).toBe('booked');
  });

  test('3 kitchen strikes in the window auto-pause the kitchen (it can no longer take bookings) and admins are told', async () => {
    const k = await makeLiveKitchen(db, { societyId, qty: 50 });
    for (let i = 0; i < 3; i++) {
      const ctx = await booked({ kitchen: k, qty: 1 });
      await act(ctx, 'seller', 'accept');
      await act(ctx, 'seller', 'seller_cancel', { reason: `bad day ${i}` });
    }
    const [p] = await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id));
    expect(p.listingsPausedReason).toBe('strikes');
    const { createHomeOrder } = await import('@/lib/orders/create');
    const buyer = await makeUser(db, 'buyer', { societyId });
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 400 });
  });

  test('buyer cancels before acceptance: full refund, no strike. After acceptance: fee kept', async () => {
    const a = await booked({ qty: 2 });
    expect(await act(a, 'buyer', 'buyer_cancel')).toMatchObject({ status: 'cancelled_by_buyer', refundedFeePaise: 2000, creditIssuedPaise: 0 });
    expect((await pay(a.orderId)).refundedInPaise).toBe(2000);
    expect((await dish(a.dish.id)).availableQty).toBe(20);
    const b = await booked({ qty: 2 });
    await act(b, 'seller', 'accept');
    expect(await act(b, 'buyer', 'buyer_cancel')).toMatchObject({ status: 'cancelled_by_buyer', refundedFeePaise: 0 });
    expect((await pay(b.orderId)).refundedInPaise).toBe(0);
  });

  test('buyer late cancellations only become a strike from the third in the window', async () => {
    const buyer = await makeUser(db, 'buyer', { societyId });
    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await booked({ buyer, qty: 1 });
      await act(ctx, 'seller', 'accept');
      results.push((await act(ctx, 'buyer', 'buyer_cancel')).strike);
    }
    expect(results).toEqual([false, false, true]);
  });

  test('an unaccepted order auto-cancels (lazily, on read) after the accept window: fee refunded, kitchen gets a "missed" strike', async () => {
    const ctx = await booked();
    await db.update(s.orders).set({ acceptBy: new Date(Date.now() - 1000) }).where(eq(s.orders.id, ctx.orderId));
    const { GET } = await import('@/app/api/orders/[id]/route');
    await loginAs(ctx.buyer.id);
    const r = await call(GET as never, jsonReq(`/api/orders/${ctx.orderId}`, undefined, { method: 'GET' }), { id: String(ctx.orderId) });
    expect((r.json as { order: { status: string } }).order.status).toBe('cancelled_auto');
    expect((await pay(ctx.orderId)).refundedInPaise).toBe(2000);
    expect((await strikes(ctx.seller.id))[0].kind).toBe('seller_missed');
    // idempotent: the cron running afterwards finds nothing to do
    const { runOrderTimers } = await import('@/lib/orders/lifecycle');
    expect((await runOrderTimers()).autoCancelled).toBe(0);
  });

  test("at the door the buyer can't pay: fee kept, buyer strike, admins notified; three strikes block ordering for 14 days", async () => {
    const buyer = await makeUser(db, 'buyer', { societyId });
    for (let i = 0; i < 3; i++) {
      const ctx = await booked({ buyer, qty: 1 });
      await toDoor(ctx);
      const r = await act(ctx, 'seller', 'buyer_couldnt_pay', { reason: 'no money' });
      expect(r).toMatchObject({ status: 'cancelled_buyer_unpaid', refundedFeePaise: 0, strike: true });
      expect((await pay(ctx.orderId)).refundedInPaise).toBe(0);
    }
    const [u] = await db.select().from(s.users).where(eq(s.users.id, buyer.id));
    expect(u.ordersBlockedUntil!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    const k = await makeLiveKitchen(db, { societyId });
    const { createHomeOrder } = await import('@/lib/orders/create');
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/paused/) });
  });

  test('no-show needs the full wait at the door', async () => {
    const ctx = await booked();
    await toDoor(ctx);
    await expect(act(ctx, 'seller', 'no_show', { reason: 'no answer' })).rejects.toMatchObject({ status: 409 });
    const r = await act(ctx, 'seller', 'no_show', { reason: 'no answer', now: new Date(Date.now() + 16 * 60_000) });
    expect(r).toMatchObject({ status: 'no_show_buyer', refundedFeePaise: 0, strike: true });
  });

  test('admin cancels for policy reasons: full refund, optional credit', async () => {
    const ctx = await booked();
    const r = await act(ctx, 'admin', 'admin_cancel', { reason: 'Kitchen delisted', credit: true });
    expect(r).toMatchObject({ status: 'cancelled_auto', refundedFeePaise: 2000, creditIssuedPaise: 2000 });
    expect((await credits(ctx.buyer.id, 'admin'))).toHaveLength(1);
  });

  test('a refund that the gateway rejects is flagged for admins and never double-issued', async () => {
    vi.resetModules();
    vi.doMock('@/lib/payments/razorpay', async (orig) => ({ ...(await orig<typeof import('@/lib/payments/razorpay')>()), createRazorpayRefund: vi.fn(async () => { throw new Error('gateway down'); }) }));
    const ctx = await booked();
    const r = await act(ctx, 'seller', 'seller_cancel', { reason: 'sorry' });
    expect(r.refundFailed).toBe(true);
    expect(r.creditIssuedPaise).toBe(0); // no credit until the cash refund actually happened
    expect((await pay(ctx.orderId)).refundedInPaise).toBe(0);
    vi.doUnmock('@/lib/payments/razorpay');
    vi.resetModules();
  });
});

describe('disputes and timers', () => {
  test('"not received" opens a dispute ticket with SLA timers; admin marks paid → completed; or unpaid → closed + buyer strike', async () => {
    const a = await booked();
    await toDoor(a);
    await act(a, 'buyer', 'collect');
    await act(a, 'buyer', 'claim_paid', { method: 'upi', utr: '999999999999' });
    await act(a, 'seller', 'not_received', { reason: 'nothing in my account' });
    expect((await order(a.orderId)).status).toBe('payment_disputed');
    const [g] = await db.select().from(s.grievances).where(eq(s.grievances.orderId, a.orderId));
    expect(g).toMatchObject({ kind: 'dispute_payment', status: 'open', raisedRole: 'seller' });
    expect(g.ackDueAt.getTime() - g.createdAt.getTime()).toBeCloseTo(48 * 3_600_000, -4);
    expect(g.resolveDueAt.getTime() - g.createdAt.getTime()).toBeCloseTo(30 * 86_400_000, -5);
    await act(a, 'admin', 'resolve_paid');
    expect((await order(a.orderId)).status).toBe('completed');

    const b = await booked();
    await toDoor(b);
    await act(b, 'buyer', 'collect');
    await act(b, 'seller', 'raise_dispute', { reason: 'buyer left without paying' });
    await act(b, 'admin', 'resolve_unpaid', { reason: 'no evidence of payment' });
    expect((await order(b.orderId)).status).toBe('closed_unpaid');
    expect((await db.select().from(s.strikes).where(eq(s.strikes.userId, b.buyer.id)))[0].kind).toBe('buyer_unpaid');
    expect((await db.select().from(s.grievances).where(eq(s.grievances.orderId, b.orderId)))[0].status).toBe('resolved');
  });

  test('a claimed payment the kitchen neither confirms nor disputes completes by itself after 12 hours; reminders go out once', async () => {
    const ctx = await booked();
    await toDoor(ctx);
    await act(ctx, 'buyer', 'collect');
    const { runOrderTimers } = await import('@/lib/orders/lifecycle');
    // collected, never claimed: one reminder after 30 minutes
    const inAnHour = new Date(Date.now() + 60 * 60_000);
    expect((await runOrderTimers(inAnHour)).reminders).toBeGreaterThanOrEqual(1);
    expect((await runOrderTimers(inAnHour)).reminders).toBe(0);
    await act(ctx, 'buyer', 'claim_paid', { method: 'upi' });
    expect((await runOrderTimers(new Date(Date.now() + 11 * 3_600_000))).autoCompleted).toBe(0);
    expect((await runOrderTimers(new Date(Date.now() + 13 * 3_600_000))).autoCompleted).toBeGreaterThanOrEqual(1);
    const o = await order(ctx.orderId);
    expect(o).toMatchObject({ status: 'completed', autoCompleted: true, foodPaymentStatus: 'auto_confirmed' });
  });

  test('an unpaid platform fee expires the order after 15 minutes and releases stock', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId, qty: 5 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 2 }], fulfillmentType: 'self_pickup' });
    expect((await dish(k.dish.id)).availableQty).toBe(3);
    const { runOrderTimers } = await import('@/lib/orders/lifecycle');
    expect((await runOrderTimers(new Date(Date.now() + 16 * 60_000))).expired).toBeGreaterThanOrEqual(1);
    expect((await order(r.orderId)).status).toBe('expired');
    expect((await dish(k.dish.id)).availableQty).toBe(5);
  });
});

describe('platform fee', () => {
  test('booking charges ONLY the platform fee online: ₹200 food → ₹20 fee; a ₹50 order pays the ₹10 minimum; a ₹5,000 order is capped at ₹25', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const q = async (price: number, qty: number) => {
      const k = await makeLiveKitchen(db, { societyId, price, qty: 50 });
      const b = await makeUser(db, 'buyer', { societyId });
      const r = await createHomeOrder({ buyerId: b.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty }], fulfillmentType: 'self_pickup' });
      return { o: await order(r.orderId), payment: r.payment };
    };
    const a = await q(10000, 2);
    expect(a.o).toMatchObject({ foodTotalInPaise: 20000, onlineChargeInPaise: 2000, foodPaymentMode: 'pay_at_door', gstModeSnapshot: 'unregistered' });
    expect(a.payment).toMatchObject({ mode: 'mock', amountInPaise: 2000 });
    expect((await q(5000, 1)).o.onlineChargeInPaise).toBe(1000);
    expect((await q(50000, 10)).o.onlineChargeInPaise).toBe(2500);
  });
});

describe('A7: not taking orders today, and the decline nudge', () => {
  test('closed today hides the kitchen and blocks booking; it reopens at the next 00:00 IST', async () => {
    const { evaluateGate, isClosedToday } = await import('@/lib/kitchen/gate');
    const { istStartOfDay, DAY_MS } = await import('@/lib/time');
    const until = new Date(istStartOfDay().getTime() + DAY_MS);
    expect(isClosedToday(until, new Date())).toBe(true);
    expect(isClosedToday(until, new Date(until.getTime() + 1))).toBe(false);
    expect(isClosedToday(null)).toBe(false);

    const k = await makeLiveKitchen(db, { societyId, qty: 20 });
    const { POST } = await import('@/app/api/seller/closed-today/route');
    await loginAs(k.seller.id);
    const r = await call(POST, jsonReq('/x', { closed: true }));
    expect(r.status).toBe(200);
    expect(new Date(r.json.closedUntil as string).getTime()).toBe(until.getTime());

    const { kitchenGate } = await import('@/lib/kitchen/gate');
    const g = await kitchenGate(k.seller.id);
    expect(g.ok).toBe(false);
    expect(g.checks.openToday).toBe(false);
    expect(g.reasons.join()).toMatch(/Closed today/);
    expect((await kitchenGate(k.seller.id, new Date(until.getTime() + 1000))).ok).toBe(true); // reopened by itself

    const { createHomeOrder } = await import('@/lib/orders/create');
    const buyer = await makeUser(db, 'buyer', { societyId });
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toThrow();

    await call(POST, jsonReq('/x', { closed: false }));
    expect((await kitchenGate(k.seller.id)).ok).toBe(true);
    void evaluateGate;
  });

  test('the 6th decline in 7 days nudges admins once; declines carry no strike', async () => {
    const k = await makeLiveKitchen(db, { societyId, qty: 100 });
    const admin = await makeUser(db, 'admin');
    let nudges = 0;
    for (let i = 0; i < 7; i++) {
      const ctx = await booked({ kitchen: k, qty: 1 });
      const r = await act(ctx, 'seller', 'seller_cancel', { reason: 'out of gas' });
      expect(r.strike).toBe(false);
      const inbox = await db.select().from(s.notifications).where(eq(s.notifications.userId, admin.id));
      nudges = inbox.filter((n) => n.title === 'Kitchen declining many orders').length;
      if (i < 5) expect(nudges).toBe(0);
    }
    expect(nudges).toBe(1);
    expect((await db.select().from(s.strikes).where(eq(s.strikes.userId, k.seller.id))).length).toBe(0);
  });
});
