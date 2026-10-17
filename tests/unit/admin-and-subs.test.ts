import { beforeAll, describe, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { call, checkoutSignature, jsonReq, loginAs } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { parseSettingsPatch, crossCheck } from '@/lib/settings/defs';
import { getPlatformSettings } from '@/lib/db/platform';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
let admin: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  process.env.MOCK_MODE = 'true';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
  admin = await makeUser(db, 'admin');
  process.env.ADMIN_EMAILS = admin.email!;
  const { seedSubscriptionPlans } = await import('@/lib/subscriptions/plans');
  await seedSubscriptionPlans(db);
});

describe('settings validation bounds', () => {
  test('rejects out-of-range, fractional and wrong-typed money / percentage fields', () => {
    const bad = (body: unknown) => parseSettingsPatch(body).errors.length > 0;
    expect(bad({ buyerPlatformFeeBps: 2501 })).toBe(true); // > 25%
    expect(bad({ buyerPlatformFeeBps: -1 })).toBe(true);
    expect(bad({ buyerPlatformFeeBps: 1000.5 })).toBe(true); // not an integer
    expect(bad({ buyerPlatformFeeBps: '1000' })).toBe(true);
    expect(bad({ commissionMallPct: 150 })).toBe(true); // commission over 100%
    expect(bad({ buyerPlatformFeeMinPaise: 1.5 })).toBe(true);
    expect(bad({ subscriptionGraceDays: 31 })).toBe(true);
    expect(bad({ ecoFoodGstMode: 'sometimes' })).toBe(true);
    expect(bad({ platformGstin: 'not-a-gstin' })).toBe(true);
    expect(bad({ subscriptionReminderDays: '7;1' })).toBe(true);
    expect(bad({ nope: 1 })).toBe(true);
    expect(bad({ buyerPlatformFeeBps: 0, subscriptionGraceDays: 0, buyerPlatformFeeMaxPaise: 0, platformGstin: '36ABCDE1234F1Z5', ecoFoodGstMode: 'collect_with_platform_fee' })).toBe(false);
    expect(bad({ buyerPlatformFeeBps: 2500 })).toBe(false);
  });
  test('cap below floor is refused', async () => {
    const cur = await getPlatformSettings();
    expect(crossCheck({ ...cur, buyerPlatformFeeMinPaise: 5000, buyerPlatformFeeMaxPaise: 1000 })).toHaveLength(1);
    expect(crossCheck({ ...cur, buyerPlatformFeeMinPaise: 5000, buyerPlatformFeeMaxPaise: 0 })).toHaveLength(0);
  });
  test('PATCH /api/admin/settings: admin only, validated, audited, and defaults match the spec', async () => {
    const { GET, PATCH } = await import('@/app/api/admin/settings/route');
    const buyer = await makeUser(db, 'buyer');
    await loginAs(buyer.id);
    expect((await call(PATCH, jsonReq('/api/admin/settings', { buyerPlatformFeeBps: 500 }, { method: 'PATCH' }))).status).toBe(403);
    await loginAs(admin.id);
    const def = await call(GET, jsonReq('/api/admin/settings', undefined, { method: 'GET' }));
    expect(def.json.settings).toMatchObject({ buyerPlatformFeeBps: 1000, buyerPlatformFeeMinPaise: 0, buyerPlatformFeeMaxPaise: 0, platformFeeGstBps: 1800, ecoFoodGstMode: 'off', subscriptionGraceDays: 3, dishModerationEnabled: true, restaurantConsoleEnabled: false, mallModeEnabled: false, fssaiBasicFeePerYear: 100, fssaiDocRetentionDays: 30 });
    expect((await call(PATCH, jsonReq('/api/admin/settings', { buyerPlatformFeeBps: 9000 }, { method: 'PATCH' }))).status).toBe(400);
    const ok = await call(PATCH, jsonReq('/api/admin/settings', { buyerPlatformFeeBps: 1200 }, { method: 'PATCH' }));
    expect(ok.status).toBe(200);
    expect((await getPlatformSettings()).buyerPlatformFeeBps).toBe(1200);
    expect((await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'settings.update'))).length).toBe(1);
    await call(PATCH, jsonReq('/api/admin/settings', { buyerPlatformFeeBps: 1000 }, { method: 'PATCH' }));
  });
  test('GST is only charged once a GSTIN is on file', async () => {
    const { feeConfigFromSettings, quoteOrder } = await import('@/lib/money');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    expect(quoteOrder({ foodSubtotalPaise: 20000 }, feeConfigFromSettings(await getPlatformSettings())).feeGstPaise).toBe(0);
    await setPlatformSetting('platformGstin', '36ABCDE1234F1Z5');
    expect(quoteOrder({ foodSubtotalPaise: 20000 }, feeConfigFromSettings(await getPlatformSettings())).feeGstPaise).toBe(360);
    await setPlatformSetting('platformGstin', '');
  });
});

describe('admin authorisation', () => {
  test('non-admin users are denied every admin API; unauthenticated gets 401', async () => {
    const routes = [
      ['@/app/api/admin/kitchens/route', 'GET'], ['@/app/api/admin/societies/route', 'GET'], ['@/app/api/admin/users/route', 'GET'],
      ['@/app/api/admin/inbox/route', 'GET'], ['@/app/api/admin/dishes/route', 'GET'], ['@/app/api/admin/revenue/route', 'GET'],
      ['@/app/api/admin/refunds/route', 'GET'], ['@/app/api/admin/outbox/route', 'GET'], ['@/app/api/admin/approvals/route', 'GET'],
    ] as const;
    const seller = (await makeLiveKitchen(db, { societyId })).seller;
    for (const [path, method] of routes) {
      const mod = await import(/* @vite-ignore */ path);
      await loginAs(seller.id);
      expect((await call(mod[method], jsonReq('/x', undefined, { method }))).status, path).toBe(403);
      const { resetRequestContext } = await import('../helpers/next-headers');
      resetRequestContext();
      expect((await call(mod[method], jsonReq('/x', undefined, { method }))).status, path).toBe(401);
    }
  });
});

describe('kitchen admin actions: approve / request changes / delist / relist / messaging', () => {
  async function submittedKitchen() {
    const seller = await makeUser(db, 'seller', { societyId });
    await db.insert(s.sellerProfiles).values({ userId: seller.id, kitchenName: 'Req Kitchen', listingState: 'submitted', fssaiStatus: 'verified', upiVpa: 'req@okbank', upiName: 'Req', kitchenPhotosJson: ['/a', '/b', '/c'] });
    await db.insert(s.kitchenSubscriptions).values({ sellerId: seller.id, status: 'active', startsAt: new Date(Date.now() - 1e6), endsAt: new Date(Date.now() + 40 * 86_400_000), planNameSnapshot: 'T', durationMonthsSnapshot: 1 });
    const [dish] = await db.insert(s.listings).values({ sellerId: seller.id, title: 'Dal', priceInPaise: 8000, cuisine: 'Indian', availableQty: 5, moderationStatus: 'approved' }).returning();
    return { seller, dish };
  }
  const act = async (id: number, body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/admin/kitchens/[id]/route');
    await loginAs(admin.id);
    return call(POST, jsonReq(`/api/admin/kitchens/${id}`, body), { id: String(id) });
  };
  const visible = async (dishId: number) => {
    const { browseListings } = await import('@/lib/browse');
    return (await browseListings({})).listings.some((l) => l.id === dishId);
  };

  test('request changes needs a reason, notifies the kitchen, kitchen resubmits, admin approves → live', async () => {
    const { seller, dish } = await submittedKitchen();
    expect((await act(seller.id, { action: 'request_changes', reason: '' })).status).toBe(400);
    expect((await act(seller.id, { action: 'request_changes', reason: 'Photos are dark' })).status).toBe(200);
    const [p] = await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, seller.id));
    expect(p).toMatchObject({ listingState: 'changes_requested', listingReviewNote: 'Photos are dark', isApproved: false });
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, seller.id))).some((n) => n.body?.includes('Photos are dark'))).toBe(true);
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, seller.id))).length).toBeGreaterThan(0);
    expect(await visible(dish.id)).toBe(false);
    const { POST: submit } = await import('@/app/api/seller/listing-request/route');
    await loginAs(seller.id);
    expect((await call(submit, jsonReq('/api/seller/listing-request'))).status).toBe(200);
    expect((await act(seller.id, { action: 'approve' })).status).toBe(200);
    expect(await visible(dish.id)).toBe(true);
  });

  test('delist hides every dish, blocks new orders but not open ones; relist restores; both audited', async () => {
    const { seller, dish } = await submittedKitchen();
    await act(seller.id, { action: 'approve' });
    expect(await visible(dish.id)).toBe(true);
    expect((await act(seller.id, { action: 'delist', category: 'hygiene', reason: '' })).status).toBe(400);
    expect((await act(seller.id, { action: 'delist', category: 'hygiene', reason: 'Kitchen inspection failed' })).status).toBe(200);
    expect(await visible(dish.id)).toBe(false);
    const { createHomeOrder } = await import('@/lib/orders/create');
    const buyer = await makeUser(db, 'buyer', { societyId });
    await expect(createHomeOrder({ buyerId: buyer.id, buyerApproved: true, sellerId: seller.id, items: [{ id: dish.id, qty: 1 }], fulfillmentType: 'self_pickup', foodPaymentMode: 'upi_now' })).rejects.toMatchObject({ status: 400 });
    // subscription untouched
    expect((await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.sellerId, seller.id)))[0].status).toBe('active');
    expect((await act(seller.id, { action: 'relist' })).status).toBe(200);
    expect(await visible(dish.id)).toBe(true);
    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.targetType, 'kitchen'), eq(s.auditLog.targetId, String(seller.id))));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['kitchen.approve', 'kitchen.delist', 'kitchen.relist']));
    // illegal: relist an approved kitchen
    expect((await act(seller.id, { action: 'relist' })).status).toBe(409);
  });

  test('delisting a single dish hides only that dish and can be undone', async () => {
    const { seller, dish } = await submittedKitchen();
    const [d2] = await db.insert(s.listings).values({ sellerId: seller.id, title: 'Rice', priceInPaise: 5000, cuisine: 'Indian', availableQty: 5, moderationStatus: 'approved' }).returning();
    await act(seller.id, { action: 'approve' });
    expect((await act(seller.id, { action: 'hide_dish', dishId: dish.id, category: 'misleading_listing', reason: 'Photo is not the dish' })).status).toBe(200);
    expect(await visible(dish.id)).toBe(false);
    expect(await visible(d2.id)).toBe(true);
    expect((await act(seller.id, { action: 'unhide_dish', dishId: dish.id })).status).toBe(200);
    expect(await visible(dish.id)).toBe(true);
  });

  test('admin ↔ kitchen messaging: template message → seller inbox with unread badge → reply → admin sees it; emailed', async () => {
    const { seller } = await submittedKitchen();
    await act(seller.id, { action: 'message', subject: 'Photos need improvement', body: 'Please add brighter photos.' });
    const { GET: list } = await import('@/app/api/seller/inbox/route');
    await loginAs(seller.id);
    const inbox = await call(list, jsonReq('/x', undefined, { method: 'GET' }));
    expect(inbox.json.unread).toBe(1);
    const t = (inbox.json.threads as { id: number; subject: string }[])[0];
    expect(t.subject).toBe('Photos need improvement');
    const { GET: open, POST: reply } = await import('@/app/api/seller/inbox/[id]/route');
    await call(open, jsonReq('/x', undefined, { method: 'GET' }), { id: String(t.id) });
    expect((await call(list, jsonReq('/x', undefined, { method: 'GET' }))).json.unread).toBe(0);
    expect((await call(reply, jsonReq('/x', { body: 'Done, uploaded new ones.' }), { id: String(t.id) })).status).toBe(200);
    const { adminUnreadCount } = await import('@/lib/messaging/admin-threads');
    expect(await adminUnreadCount()).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(s.emailOutbox).where(and(eq(s.emailOutbox.userId, seller.id), eq(s.emailOutbox.kind, 'admin_message')))).length).toBe(1);
    // another seller cannot read this thread
    const stranger = (await makeLiveKitchen(db, { societyId })).seller;
    await loginAs(stranger.id);
    expect((await call(open, jsonReq('/x', undefined, { method: 'GET' }), { id: String(t.id) })).status).toBe(404);
  });
});

describe('dish moderation through the seller API', () => {
  test('new dish → pending (hidden); admin approves → visible; big price change re-queues it', async () => {
    const { seller } = await makeLiveKitchen(db, { societyId });
    const { POST: create } = await import('@/app/api/seller/listings/route');
    const { PATCH: edit } = await import('@/app/api/seller/listings/[id]/route');
    await loginAs(seller.id);
    const c = await call(create, jsonReq('/x', { title: 'Pulao', priceRupees: 200, isVeg: true, cuisine: 'Indian', prepTimeMins: 30, availableQty: 5 }));
    const id = (c.json.listing as { id: number }).id;
    expect((c.json.listing as { moderationStatus: string }).moderationStatus).toBe('pending');
    const { browseListings } = await import('@/lib/browse');
    expect((await browseListings({})).listings.some((l) => l.id === id)).toBe(false);
    const { POST: review } = await import('@/app/api/admin/dishes/[id]/route');
    await loginAs(admin.id);
    expect((await call(review, jsonReq('/x', { action: 'reject', reason: '' }), { id: String(id) })).status).toBe(400);
    expect((await call(review, jsonReq('/x', { action: 'approve' }), { id: String(id) })).status).toBe(200);
    expect((await browseListings({})).listings.some((l) => l.id === id)).toBe(true);
    await loginAs(seller.id);
    await call(edit, jsonReq('/x', { priceRupees: 240 }, { method: 'PATCH' }), { id: String(id) });
    expect((await db.select().from(s.listings).where(eq(s.listings.id, id)))[0].moderationStatus).toBe('approved'); // +20%
    await call(edit, jsonReq('/x', { priceRupees: 400 }, { method: 'PATCH' }), { id: String(id) });
    expect((await db.select().from(s.listings).where(eq(s.listings.id, id)))[0].moderationStatus).toBe('pending'); // >30% from last approved
    await call(edit, jsonReq('/x', { title: 'Pulao Special', priceRupees: 200 }, { method: 'PATCH' }), { id: String(id) });
    expect((await db.select().from(s.listings).where(eq(s.listings.id, id)))[0].moderationStatus).toBe('pending');
    expect((await call(create, jsonReq('/x', { title: 'Bad', priceRupees: -5, isVeg: true, cuisine: 'x', availableQty: 1 }))).status).toBe(400);
    expect((await call(create, jsonReq('/x', { title: 'Bad', priceRupees: 5, isVeg: true, cuisine: 'x', availableQty: 1.5 }))).status).toBe(400);
  });
});

describe('subscription service', () => {
  async function newSeller() {
    const seller = await makeUser(db, 'seller', { societyId });
    await db.insert(s.sellerProfiles).values({ userId: seller.id, kitchenName: 'Sub K' });
    return seller;
  }
  const plan = async () => (await db.select().from(s.subscriptionPlans))[0];

  test('pay → active for N months; second payment stacks; double-processing pays once', async () => {
    const { startSubscriptionPayment, markSubscriptionPaid } = await import('@/lib/subscriptions/service');
    const seller = await newSeller();
    const p = await plan();
    const c1 = await startSubscriptionPayment(seller.id, p.id);
    const [pending] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, c1.subscriptionId));
    expect(pending).toMatchObject({ status: 'pending_payment', pricePaiseSnapshot: 29900, gstPaise: 0, durationMonthsSnapshot: 3 });
    const res = await Promise.all([markSubscriptionPaid(c1.subscriptionId), markSubscriptionPaid(c1.subscriptionId)]);
    expect(res.filter((r) => r.won)).toHaveLength(1);
    const [first] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, c1.subscriptionId));
    expect(first.status).toBe('active');
    const c2 = await startSubscriptionPayment(seller.id, p.id);
    await markSubscriptionPaid(c2.subscriptionId);
    const [second] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, c2.subscriptionId));
    expect(second.startsAt!.toISOString()).toBe(first.endsAt!.toISOString()); // stacked
    // snapshot is immutable when the plan price changes later
    await db.update(s.subscriptionPlans).set({ pricePaise: 99900 }).where(eq(s.subscriptionPlans.id, p.id));
    expect((await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, c1.subscriptionId)))[0].pricePaiseSnapshot).toBe(29900);
    await db.update(s.subscriptionPlans).set({ pricePaise: 29900 }).where(eq(s.subscriptionPlans.id, p.id));
  });

  test('subscription verify route: only the owning seller, valid signature; GST added only with a GSTIN', async () => {
    const { startSubscriptionPayment } = await import('@/lib/subscriptions/service');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('platformGstin', '36ABCDE1234F1Z5');
    const seller = await newSeller();
    const other = await newSeller();
    const c = await startSubscriptionPayment(seller.id, (await plan()).id);
    await setPlatformSetting('platformGstin', '');
    const [sub] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, c.subscriptionId));
    expect(sub).toMatchObject({ gstPaise: 5382, gstBpsSnapshot: 1800 });
    const { POST } = await import('@/app/api/payments/verify/route');
    const body = { subscriptionId: sub.id, razorpay_order_id: sub.razorpayOrderId, razorpay_payment_id: 'pay_s1', razorpay_signature: checkoutSignature(sub.razorpayOrderId!, 'pay_s1') };
    await loginAs(other.id);
    expect((await call(POST, jsonReq('/x', body))).status).toBe(400);
    await loginAs(seller.id);
    expect((await call(POST, jsonReq('/x', { ...body, razorpay_signature: 'bad' }))).status).toBe(400);
    expect((await call(POST, jsonReq('/x', { ...body, subscriptionId: sub.id + 999 }))).status).toBe(400);
    expect((await call(POST, jsonReq('/x', body))).status).toBe(200);
    expect((await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, sub.id)))[0].status).toBe('active');
  });

  test('admin: grant a free period, extend, cancel (reason required, audited); invoice PDF generated', async () => {
    const { grantSubscription, extendSubscription, cancelSubscription } = await import('@/lib/subscriptions/service');
    const seller = await newSeller();
    await expect(grantSubscription({ adminId: admin.id, sellerId: seller.id, months: 1, reason: '' })).rejects.toMatchObject({ status: 400 });
    await expect(grantSubscription({ adminId: admin.id, sellerId: seller.id, months: 13, reason: 'x' })).rejects.toMatchObject({ status: 400 });
    const g = await grantSubscription({ adminId: admin.id, sellerId: seller.id, months: 1, reason: 'Founding kitchen' });
    expect(g).toMatchObject({ status: 'waived', grantedByAdminId: admin.id });
    const before = g.endsAt!.getTime();
    const e = await extendSubscription({ adminId: admin.id, subscriptionId: g.id, days: 10, reason: 'Compensation for delist' });
    expect(e.endsAt!.getTime() - before).toBe(10 * 86_400_000);
    const c = await cancelSubscription({ adminId: admin.id, subscriptionId: g.id, reason: 'Left the society' });
    expect(c.status).toBe('cancelled');
    const { sellerIsSubscribed } = await import('@/lib/subscriptions/queries');
    expect(await sellerIsSubscribed(seller.id)).toBe(false);
    expect((await db.select().from(s.auditLog).where(eq(s.auditLog.targetId, String(g.id)))).map((a) => a.action)).toEqual(expect.arrayContaining(['subscription.grant', 'subscription.extend', 'subscription.cancel']));

    const { buildSubscriptionInvoice, invoiceNumber } = await import('@/lib/invoices/subscription-invoice');
    const pdf = await buildSubscriptionInvoice({ invoiceNo: invoiceNumber(7, new Date('2026-02-01')), issuedAt: new Date(), seller: { kitchenName: 'K', ownerName: 'O', society: 'S' }, plan: { name: 'Launch – 3 months', months: 3, startsAt: new Date(), endsAt: new Date() }, basePaise: 29900, gstPaise: 5382, gstBps: 1800, totalPaise: 35282, razorpayPaymentId: 'pay_x', platform: { legalName: 'L', gstin: '36ABCDE1234F1Z5', address: 'A' } });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(invoiceNumber(7, new Date('2026-02-01'))).toBe('PP-S-2026-00007');
  });

  test('sync: persists grace/expired, sends renewal reminders once, expiry hides the kitchen and renewal restores it', async () => {
    const { syncSubscriptions, startSubscriptionPayment, markSubscriptionPaid } = await import('@/lib/subscriptions/service');
    const { browseListings } = await import('@/lib/browse');
    const { seller, dish } = await makeLiveKitchen(db, { societyId });
    const [sub] = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.sellerId, seller.id));
    const end = new Date('2026-06-10T06:00:00Z');
    await db.update(s.kitchenSubscriptions).set({ startsAt: new Date('2026-03-10T06:00:00Z'), endsAt: end }).where(eq(s.kitchenSubscriptions.id, sub.id));
    const day = (d: string) => new Date(`${d}T06:00:00Z`);
    expect((await syncSubscriptions(day('2026-06-03'))).reminded).toBe(1); // 7-day reminder
    expect((await syncSubscriptions(day('2026-06-03'))).reminded).toBe(0); // once
    expect((await syncSubscriptions(day('2026-06-09'))).reminded).toBe(1); // 1-day reminder
    expect((await syncSubscriptions(day('2026-06-11'))).moved).toBe(1);
    expect((await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, sub.id)))[0].status).toBe('grace');
    expect((await syncSubscriptions(day('2026-06-14'))).moved).toBe(1);
    expect((await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.id, sub.id)))[0].status).toBe('expired');
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, seller.id))).length).toBeGreaterThanOrEqual(4);
    // the real clock is far past 2026-06 → also hidden for real
    expect((await browseListings({})).listings.some((l) => l.id === dish.id)).toBe(false);
    const co = await startSubscriptionPayment(seller.id, (await db.select().from(s.subscriptionPlans))[0].id);
    await markSubscriptionPaid(co.subscriptionId);
    expect((await browseListings({})).listings.some((l) => l.id === dish.id)).toBe(true);
  });
});

describe('CSRF origin check (middleware)', () => {
  test('cross-site mutating API calls are blocked; same-origin, no-Origin and webhook calls pass', async () => {
    const { middleware } = await import('@/middleware');
    const mk = (origin: string | null, path = '/api/orders', method = 'POST') =>
      new NextRequest(`http://localhost:3000${path}`, { method, headers: { host: 'localhost:3000', ...(origin ? { origin } : {}) } });
    expect((await middleware(mk('https://evil.example'))).status).toBe(403);
    expect((await middleware(mk('http://localhost:3000'))).status).toBe(200);
    expect((await middleware(mk(null))).status).toBe(200);
    expect((await middleware(mk('https://evil.example', '/api/webhooks/razorpay'))).status).toBe(200);
    expect((await middleware(mk('https://evil.example', '/api/orders', 'GET'))).status).toBe(200);
  });
});

describe('buyer ↔ kitchen threads', () => {
  test('handles only, quick replies, profanity & phone filters, read-only after 7 days, admin only with a complaint (audited), block', async () => {
    const { readThread, postMessage, threadState, hasProfanity, blockOther } = await import('@/lib/messaging/order-thread');
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const { seller, dish } = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const r = await createHomeOrder({ buyerId: buyer.id, buyerApproved: true, sellerId: seller.id, items: [{ id: dish.id, qty: 1 }], fulfillmentType: 'self_pickup', foodPaymentMode: 'upi_now' });
    const { resolveSession } = await import('@/lib/auth');
    const sess = async (u: number) => { await loginAs(u); const [row] = await db.select().from(s.sessions).where(eq(s.sessions.userId, u)); return (await resolveSession(row.id))!; };
    const buyerS = await sess(buyer.id);
    await expect(readThread(r.orderId, buyerS)).rejects.toMatchObject({ status: 404 }); // not open until the fee is paid
    await markOrderPaid(r.orderId);
    const sellerS = await sess(seller.id);
    await postMessage(r.orderId, buyerS, { quickReplyKey: 'late5' });
    await postMessage(r.orderId, sellerS, { body: 'No problem, see you soon' });
    await expect(postMessage(r.orderId, buyerS, { body: 'call me on 9876543210' })).rejects.toMatchObject({ status: 400 });
    await expect(postMessage(r.orderId, buyerS, { body: 'what the fuck' })).rejects.toMatchObject({ status: 400 });
    expect(hasProfanity('you b1tch')).toBe(true);
    expect(hasProfanity('scunthorpe class')).toBe(false);
    const t = await readThread(r.orderId, buyerS);
    expect(t.messages.map((m) => m.label)).toEqual([expect.stringMatching(/^Buyer #[A-Z]\d$/), expect.stringMatching(/^Kitchen: /)]);
    const blob = JSON.stringify(t);
    expect(blob).not.toContain(buyer.phone);
    expect(blob).not.toContain(buyer.name);
    // admin: blocked until a complaint exists, then audited
    const adminS = await sess(admin.id);
    await expect(readThread(r.orderId, adminS)).rejects.toMatchObject({ status: 403 });
    await db.insert(s.complaints).values({ orderId: r.orderId, buyerId: buyer.id, sellerId: seller.id, category: 'quality', description: 'x' });
    await readThread(r.orderId, adminS);
    expect((await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'thread.read'))).length).toBe(1);
    await expect(postMessage(r.orderId, adminS, { body: 'hi' })).rejects.toMatchObject({ status: 403 });
    // read-only 7 days after completion
    const done = new Date('2026-01-01T00:00:00Z');
    expect(threadState({ status: 'picked_up', completedAt: done, updatedAt: done }, new Date('2026-01-07T23:00:00Z')).open).toBe(true);
    expect(threadState({ status: 'picked_up', completedAt: done, updatedAt: done }, new Date('2026-01-08T00:00:01Z')).open).toBe(false);
    // block
    await blockOther(r.orderId, sellerS);
    await expect(postMessage(r.orderId, buyerS, { body: 'hello?' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('revenue report and CSV', () => {
  test('sums platform fee + subscription revenue and counts risk items', async () => {
    const { revenueReport, revenueCsv } = await import('@/lib/revenue');
    const r = await revenueReport('30d');
    expect(r.fee.orders).toBeGreaterThan(0);
    expect(r.subscriptions.count).toBeGreaterThan(0);
    expect(r.totalNetRevenuePaise).toBe(r.fee.netPaise + r.subscriptions.netPaise - r.refunds.subscriptionPaise);
    expect(revenueCsv(r)).toContain('Buyer platform fee');
    const { GET } = await import('@/app/api/admin/revenue/route');
    await loginAs(admin.id);
    const res = (await GET(jsonReq('/api/admin/revenue?range=7d&format=csv', undefined, { method: 'GET' }), {} as never)) as Response;
    expect(res.headers.get('content-type')).toContain('text/csv');
  });
});

describe('bootstrap', () => {
  test('is idempotent and creates no demo users', async () => {
    const { runBootstrap } = await import('@/lib/bootstrap');
    process.env.ADMIN_EMAILS = 'founder@example.com,partner@example.com';
    const before = (await db.select().from(s.users)).length;
    const a = await runBootstrap(db);
    expect(a.adminsCreated.map((x) => x.email).sort()).toEqual(['founder@example.com', 'partner@example.com']);
    const mid = (await db.select().from(s.users)).length;
    expect(mid - before).toBe(2);
    const b = await runBootstrap(db);
    expect(b.adminsCreated).toEqual([]);
    expect((await db.select().from(s.users)).length).toBe(mid);
    expect((await db.select().from(s.subscriptionPlans)).length).toBe(1);
    expect((await db.select().from(s.users)).filter((u) => u.phone.startsWith('99999')).length).toBe(0);
  });
  test('demo seeding refuses to run in production', async () => {
    const { runSeed } = await import('@/lib/db/seed-data');
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.ALLOW_DEMO_SEED;
    await expect(runSeed(db)).rejects.toThrow(/Refusing/);
    (process.env as Record<string, string>).NODE_ENV = prev ?? 'test';
  });
});
