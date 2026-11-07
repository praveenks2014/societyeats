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

async function completedOrder(k: Awaited<ReturnType<typeof makeLiveKitchen>>, buyer: Awaited<ReturnType<typeof makeUser>>, qty = 1) {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const { markOrderPaid } = await import('@/lib/payments');
  await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
  const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty }], fulfillmentType: 'self_pickup' });
  await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
  await db.update(s.orders).set({ status: 'completed', completedAt: new Date(), acceptedAt: new Date(), atDoorAt: new Date() }).where(eq(s.orders.id, r.orderId));
  return r.orderId;
}

describe('F1: favourites and cooking alerts', () => {
  test('follow, unfollow, list; cannot follow yourself or a non-kitchen; the flag switches it off', async () => {
    const { setFavourite, listFavourites, isFavourite } = await import('@/lib/favourites');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const k = await makeLiveKitchen(db, { societyId });
    const u = await makeUser(db, 'buyer', { societyId });
    expect(await isFavourite(u.id, k.seller.id)).toEqual({ favourite: false, notifyCooking: true });
    await setFavourite(u.id, k.seller.id, true);
    expect((await listFavourites(u.id)).map((f) => f.sellerId)).toEqual([k.seller.id]);
    await setFavourite(u.id, k.seller.id, true, false); // idempotent, updates the alert choice
    expect(await isFavourite(u.id, k.seller.id)).toEqual({ favourite: true, notifyCooking: false });
    await expect(setFavourite(k.seller.id, k.seller.id, true)).rejects.toMatchObject({ status: 400 });
    await expect(setFavourite(u.id, u.id + 9999, true)).rejects.toMatchObject({ status: 404 });
    await setFavourite(u.id, k.seller.id, false);
    expect(await listFavourites(u.id)).toEqual([]);
    await setPlatformSetting('favouritesEnabled', 'false');
    await expect(setFavourite(u.id, k.seller.id, true)).rejects.toMatchObject({ status: 404 });
    await setPlatformSetting('favouritesEnabled', 'true');
  });

  test('API: a signed-in user can follow and unfollow; visitors cannot', async () => {
    const { PUT, DELETE, GET } = await import('@/app/api/favourites/[sellerId]/route');
    const k = await makeLiveKitchen(db, { societyId });
    const u = await makeUser(db, 'buyer', { societyId });
    await loginAs(u.id);
    const p = { sellerId: String(k.seller.id) };
    expect((await call(PUT, jsonReq('/x', { notifyCooking: true }, { method: 'PUT' }), p)).status).toBe(200);
    expect((await call(GET, jsonReq('/x', undefined, { method: 'GET' }), p)).json).toMatchObject({ favourite: true });
    expect((await call(DELETE, jsonReq('/x', undefined, { method: 'DELETE' }), p)).status).toBe(200);
    expect((await call(GET, jsonReq('/x', undefined, { method: 'GET' }), p)).json).toMatchObject({ favourite: false });
  });

  test('publishing a menu alerts followers who asked, once a day per kitchen; a republish does not alert again; non-followers and opt-outs hear nothing', async () => {
    const { setFavourite } = await import('@/lib/favourites');
    const { publishMenu } = await import('@/lib/menu-posts');
    const k = await makeLiveKitchen(db, { societyId });
    const f1 = await makeUser(db, 'buyer', { societyId });
    const f2 = await makeUser(db, 'buyer', { societyId });
    const stranger = await makeUser(db, 'buyer', { societyId });
    await setFavourite(f1.id, k.seller.id, true, true);
    await setFavourite(f2.id, k.seller.id, true, false);
    const t0 = new Date('2026-12-05T06:00:00Z');
    const a = await publishMenu(k.seller.id, { listingIds: [k.dish.id], note: 'Fresh biryani' }, t0);
    expect(a.alerted).toBe(1);
    const got = (await db.select().from(s.notifications).where(eq(s.notifications.userId, f1.id))).filter((n) => n.eventKey === 'kitchen_cooking');
    expect(got).toHaveLength(1);
    expect(got[0].body).toContain('Fresh biryani');
    expect(got[0].href).toBe(`/kitchen/${k.seller.id}?menu=2026-12-05`);
    for (const u of [f2, stranger]) expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, u.id))).some((n) => n.eventKey === 'kitchen_cooking')).toBe(false);
    // update the menu the same day: no second alert
    const b = await publishMenu(k.seller.id, { listingIds: [k.dish.id], note: 'Now with raita' }, new Date(t0.getTime() + 3_600_000));
    expect(b.alerted).toBe(0);
    expect((await db.select().from(s.menuPosts).where(eq(s.menuPosts.sellerId, k.seller.id)))).toHaveLength(1);
    expect((await db.select().from(s.menuPosts).where(eq(s.menuPosts.sellerId, k.seller.id)))[0].note).toBe('Now with raita');
    // next day: alerts again
    expect((await publishMenu(k.seller.id, { listingIds: [k.dish.id] }, new Date('2026-12-06T06:00:00Z'))).alerted).toBe(1);
  });
});

describe('F2: menu post and share card', () => {
  test('only your own live, approved dishes; 1 to 12 dishes; share text and wa.me link', async () => {
    const { publishMenu, shareLink, getMenuPost } = await import('@/lib/menu-posts');
    const k = await makeLiveKitchen(db, { societyId });
    const other = await makeLiveKitchen(db, { societyId });
    await expect(publishMenu(k.seller.id, { listingIds: [] })).rejects.toMatchObject({ status: 400 });
    await expect(publishMenu(k.seller.id, { listingIds: [other.dish.id] })).rejects.toMatchObject({ status: 400 });
    await db.update(s.listings).set({ moderationStatus: 'pending' }).where(eq(s.listings.id, k.dish.id));
    await expect(publishMenu(k.seller.id, { listingIds: [k.dish.id] })).rejects.toMatchObject({ status: 400 });
    await db.update(s.listings).set({ moderationStatus: 'approved' }).where(eq(s.listings.id, k.dish.id));
    await publishMenu(k.seller.id, { listingIds: [k.dish.id], note: 'x'.repeat(300) });
    const m = (await getMenuPost(k.seller.id))!;
    expect(m.post.note!.length).toBe(200);
    expect(m.dishes.map((d) => d.id)).toEqual([k.dish.id]);
    const sh = shareLink({ kitchen: 'Kamala’s Kitchen', dishes: ['Biryani', 'Raita', 'Kheer', 'Dal', 'Roti', 'Salad', 'Pickle'], note: 'Come early', url: 'https://x.in/menu/1' });
    expect(sh.text).toContain('Kamala’s Kitchen is cooking today: Biryani, Raita, Kheer, Dal, Roti +2 more.');
    expect(sh.text).toContain('Come early');
    expect(sh.waUrl.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(sh.waUrl.split('text=')[1])).toBe(sh.text);
  });

  test('seller API publishes and returns the share link; a buyer cannot', async () => {
    const { POST, GET } = await import('@/app/api/seller/menu/route');
    const k = await makeLiveKitchen(db, { societyId });
    await loginAs(k.seller.id);
    const r = await call(POST, jsonReq('/x', { listingIds: [k.dish.id], note: 'Hot' }));
    expect(r.status).toBe(200);
    expect((r.json.share as { url: string }).url).toMatch(/\/menu\/\d+$/);
    expect((await call(GET, jsonReq('/x', undefined, { method: 'GET' }))).json).toMatchObject({ post: { note: 'Hot' } });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await loginAs(buyer.id);
    expect((await call(POST, jsonReq('/x', { listingIds: [k.dish.id] }))).status).toBeGreaterThanOrEqual(403);
  });

  test('the public menu page and its share image exist', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    expect(existsSync('src/app/menu/[id]/opengraph-image.tsx')).toBe(true);
    expect(readFileSync('src/app/menu/[id]/page.tsx', 'utf8')).toContain('openGraph');
  });
});

describe('F4: repeat order and usuals', () => {
  test('repeat uses today’s price and stock, skips what is gone, and refuses another buyer or a closed kitchen', async () => {
    const { repeatCart } = await import('@/lib/repeat');
    const k = await makeLiveKitchen(db, { societyId, qty: 50, price: 10000 });
    const [extra] = await db.insert(s.listings).values({ sellerId: k.seller.id, title: 'Kheer', priceInPaise: 5000, cuisine: 'Sweets', availableQty: 20, isActive: true, moderationStatus: 'approved' }).returning();
    const buyer = await makeUser(db, 'buyer', { societyId });
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 3 }, { id: extra.id, qty: 2 }], fulfillmentType: 'self_pickup' });
    await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
    await db.update(s.orders).set({ status: 'completed', completedAt: new Date() }).where(eq(s.orders.id, r.orderId));
    // price up, stock down, one dish paused
    await db.update(s.listings).set({ priceInPaise: 12000, availableQty: 2 }).where(eq(s.listings.id, k.dish.id));
    await db.update(s.listings).set({ isActive: false }).where(eq(s.listings.id, extra.id));
    const c = await repeatCart(r.orderId, buyer.id);
    expect(c.items).toEqual([expect.objectContaining({ id: k.dish.id, pricePaise: 12000, qty: 2, maxQty: 2 })]); // capped at what is left
    expect(c.skipped).toEqual(['Kheer']);
    expect(c.vendor).toMatchObject({ kind: 'seller', id: k.seller.id });
    const stranger = await makeUser(db, 'buyer', { societyId });
    await expect(repeatCart(r.orderId, stranger.id)).rejects.toMatchObject({ status: 404 });
    await db.update(s.listings).set({ isActive: false }).where(eq(s.listings.id, k.dish.id));
    await expect(repeatCart(r.orderId, buyer.id)).rejects.toMatchObject({ status: 409 });
    await db.update(s.listings).set({ isActive: true, availableQty: 5 }).where(eq(s.listings.id, k.dish.id));
    await db.update(s.sellerProfiles).set({ closedUntil: new Date(Date.now() + 3_600_000) }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await expect(repeatCart(r.orderId, buyer.id)).rejects.toMatchObject({ status: 409 }); // closed today
  });

  test('usuals: most-ordered first, only orderable dishes from open kitchens', async () => {
    const { usualsFor } = await import('@/lib/repeat');
    const k = await makeLiveKitchen(db, { societyId, qty: 50 });
    const [second] = await db.insert(s.listings).values({ sellerId: k.seller.id, title: 'Raita', priceInPaise: 3000, cuisine: 'Sides', availableQty: 20, isActive: true, moderationStatus: 'approved' }).returning();
    const buyer = await makeUser(db, 'buyer', { societyId });
    await completedOrder(k, buyer);
    await completedOrder(k, buyer);
    const { createHomeOrder } = await import('@/lib/orders/create');
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: second.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    await db.update(s.orders).set({ status: 'completed', completedAt: new Date() }).where(eq(s.orders.id, r.orderId));
    const u = await usualsFor(buyer.id);
    expect(u.map((x) => [x.id, x.times])).toEqual([[k.dish.id, 2], [second.id, 1]]);
    await db.update(s.listings).set({ availableQty: 0 }).where(eq(s.listings.id, second.id));
    expect((await usualsFor(buyer.id)).map((x) => x.id)).toEqual([k.dish.id]);
    expect(await usualsFor((await makeUser(db, 'buyer', { societyId })).id)).toEqual([]);
  });
});

describe('F5: quality score and Top Kitchen', () => {
  const T = { topKitchenMinOrders: 10, topKitchenMinAcceptancePct: 90, topKitchenMaxCancelPct: 5, topKitchenMinOnTimePct: 80, topKitchenOnTimeMinutes: 75, topKitchenMinRating: 4.5 };
  const t0 = new Date('2026-12-01T10:00:00Z');
  const done = (acceptMin = 0, doorMin = 30) => ({ status: 'completed', acceptedAt: new Date(t0.getTime() + acceptMin * 60_000), atDoorAt: new Date(t0.getTime() + (acceptMin + doorMin) * 60_000), cancelledBy: null });

  test('a kitchen that meets every threshold gets the badge; each shortfall removes it and says which', async () => {
    const { scoreKitchen } = await import('@/lib/quality');
    const good = Array.from({ length: 12 }, () => done());
    const ok = scoreKitchen(good, { avg: 4.8, count: 20 }, T);
    expect(ok).toMatchObject({ orders: 12, acceptancePct: 100, cancelPct: 0, onTimePct: 100, rating: 4.8, topKitchen: true });
    expect(ok.checks.every((c) => c.ok)).toBe(true);
    expect(scoreKitchen(good.slice(0, 9), { avg: 4.8, count: 20 }, T).checks.find((c) => c.key === 'orders')!.ok).toBe(false);
    expect(scoreKitchen(good, { avg: 4.4, count: 20 }, T).topKitchen).toBe(false);
    expect(scoreKitchen(good, { avg: 0, count: 0 }, T).checks.find((c) => c.key === 'rating')).toMatchObject({ ok: false, value: '–' });
    const late = [...good.slice(0, 6), ...Array.from({ length: 6 }, () => done(0, 120))];
    expect(scoreKitchen(late, { avg: 4.8, count: 20 }, T)).toMatchObject({ onTimePct: 50, topKitchen: false });
    const declines = [...good, ...Array.from({ length: 3 }, () => ({ status: 'cancelled_by_seller', acceptedAt: null, atDoorAt: null, cancelledBy: 'seller' }))];
    const d = scoreKitchen(declines, { avg: 4.8, count: 20 }, T);
    expect(d.acceptancePct).toBe(80);
    expect(d.cancelPct).toBe(20);
    expect(d.topKitchen).toBe(false);
    const missed = scoreKitchen([...good, { status: 'cancelled_auto', acceptedAt: null, atDoorAt: null, cancelledBy: 'system' }], { avg: 4.8, count: 20 }, T);
    expect(missed.acceptancePct).toBe(92.3);
    // buyer-side cancels never count against the kitchen
    expect(scoreKitchen([...good, { status: 'cancelled_by_buyer', acceptedAt: null, atDoorAt: null, cancelledBy: 'buyer' }], { avg: 4.8, count: 20 }, T).acceptancePct).toBe(100);
  });

  test('from real orders: only the kitchen sees numbers (API), the public sees the badge; the window is 30 days', async () => {
    const { qualityScore, topKitchenSet } = await import('@/lib/quality');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('topKitchenMinOrders', '2');
    const k = await makeLiveKitchen(db, { societyId, qty: 100 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const o1 = await completedOrder(k, buyer);
    const o2 = await completedOrder(k, buyer);
    await db.update(s.sellerProfiles).set({ rating: 4.9, ratingCount: 5 }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const q = await qualityScore(k.seller.id);
    expect(q.topKitchen).toBe(true);
    expect((await topKitchenSet([k.seller.id])).has(k.seller.id)).toBe(true);
    // 40 days later the orders fall out of the window → not enough orders
    expect((await qualityScore(k.seller.id, new Date(Date.now() + 40 * 86_400_000))).topKitchen).toBe(false);
    void o1; void o2;
    const { GET } = await import('@/app/api/seller/quality/route');
    await loginAs(k.seller.id);
    expect((await call(GET, jsonReq('/x', undefined, { method: 'GET' }))).json).toMatchObject({ topKitchen: true, orders: 2 });
    await loginAs(buyer.id);
    expect((await call(GET, jsonReq('/x', undefined, { method: 'GET' }))).status).toBeGreaterThanOrEqual(403);
    const { browseListings } = await import('@/lib/browse');
    const feed = await browseListings({});
    const card = feed.listings.find((l) => l.sellerId === k.seller.id);
    if (card) expect(card.topKitchen).toBe(true);
    await setPlatformSetting('topKitchenMinOrders', '10');
  });
});

describe('F6: photo reviews', () => {
  test('up to 3 of your own review photos, verified-order, seller reply still works; others’ photos are refused', async () => {
    const { POST } = await import('@/app/api/orders/[id]/review/route');
    const { saveUpload } = await import('@/lib/storage/files');
    const { setStorageForTests } = await import('@/lib/storage');
    const { MemoryStorage } = await import('@/lib/storage/memory');
    setStorageForTests(new MemoryStorage());
    const sharp = (await import('sharp')).default;
    const jpg = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#aa5500' } }).jpeg().toBuffer();
    const k = await makeLiveKitchen(db, { societyId, qty: 100 });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const other = await makeUser(db, 'buyer', { societyId });
    const orderId = await completedOrder(k, buyer);
    const mine = await Promise.all([1, 2, 3, 4].map(() => saveUpload({ ownerId: buyer.id, purpose: 'review_photo', buffer: jpg, visibility: 'public', allowed: ['image'] })));
    const theirs = await saveUpload({ ownerId: other.id, purpose: 'review_photo', buffer: jpg, visibility: 'public', allowed: ['image'] });
    const wrong = await saveUpload({ ownerId: buyer.id, purpose: 'dish', buffer: jpg, visibility: 'public', allowed: ['image'] });
    await loginAs(buyer.id);
    const p = { id: String(orderId) };
    expect((await call(POST, jsonReq('/x', { rating: 5, photos: mine.map((m) => m.key) }), p)).status).toBe(400); // 4 photos
    expect((await call(POST, jsonReq('/x', { rating: 5, photos: [theirs.key] }), p)).status).toBe(400);
    expect((await call(POST, jsonReq('/x', { rating: 5, photos: [wrong.key] }), p)).status).toBe(400);
    expect((await call(POST, jsonReq('/x', { rating: 5, text: 'Loved it', photos: mine.slice(0, 3).map((m) => m.key) }), p)).status).toBe(200);
    const [rev] = await db.select().from(s.reviews).where(eq(s.reviews.orderId, orderId));
    expect(rev.photosJson).toEqual(mine.slice(0, 3).map((m) => m.key));
    setStorageForTests(undefined);
  });

  test('the kitchen and dish pages show the verified-order badge and photos', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/app/kitchen/[id]/kitchen-client.tsx', 'src/app/dish/[id]/dish-detail.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toContain('Verified order');
      expect(src).toContain('review-photos');
    }
  });
});

describe('F3: scheduled pre-orders', () => {
  const day = (n: number, hour: number) => {
    // an instant `n` IST days from today at `hour` IST
    const now = new Date(Date.now() + 330 * 60_000);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n, hour) - 330 * 60_000);
  };
  const weekdayOf = (d: Date) => (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(d.getTime() + 330 * 60_000).getUTCDay()];

  test('time rules: inside a slot, ≥30 min away, within the horizon, lead time, cooking days and slots', async () => {
    const { checkPreOrderTime, slotForHour } = await import('@/lib/orders/preorder');
    const dish = (over: Record<string, unknown> = {}) => ({ id: 1, title: 'Biryani', leadTimeDays: 0, slotsJson: null, maxPortionsPerSlot: null, availableQty: 10, ...over }) as never;
    const now = new Date();
    const st = { preOrderMaxDays: 7 };
    expect([slotForHour(5), slotForHour(6), slotForHour(10), slotForHour(11), slotForHour(16), slotForHour(17), slotForHour(20), slotForHour(23)]).toEqual([null, 'breakfast', 'breakfast', 'lunch', null, null, 'dinner', null]);
    expect(checkPreOrderTime(day(1, 13), [dish()], st, now)).toMatchObject({ slot: 'lunch' });
    expect(() => checkPreOrderTime(day(1, 3), [dish()], st, now)).toThrow(/meal slot/);
    expect(() => checkPreOrderTime(new Date(now.getTime() + 10 * 60_000), [dish()], st, now)).toThrow();
    expect(() => checkPreOrderTime(day(8, 13), [dish()], st, now)).toThrow(/at most 7 days/);
    expect(() => checkPreOrderTime(day(1, 13), [dish({ leadTimeDays: 2 })], st, now)).toThrow(/needs 2 days/);
    expect(checkPreOrderTime(day(2, 13), [dish({ leadTimeDays: 2 })], st, now).slot).toBe('lunch');
    const t = day(3, 13);
    const other = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).find((d) => d !== weekdayOf(t))!;
    expect(() => checkPreOrderTime(t, [dish({ slotsJson: { days: [other], slots: ['lunch'] } })], st, now)).toThrow(/not cooked on/);
    expect(() => checkPreOrderTime(t, [dish({ slotsJson: { days: [weekdayOf(t)], slots: ['dinner'] } })], st, now)).toThrow(/not served at lunch/);
    expect(checkPreOrderTime(t, [dish({ slotsJson: { days: [weekdayOf(t)], slots: ['lunch'] } })], st, now).slot).toBe('lunch');
  });

  test('accept-by is the slot minus the lead hours, but never sooner than the normal window', async () => {
    const { preOrderAcceptBy } = await import('@/lib/orders/preorder');
    const now = new Date('2026-12-01T06:00:00Z');
    const cfg = { sellerAcceptWindowMinutes: 20, preOrderAcceptLeadHours: 4 };
    expect(preOrderAcceptBy(new Date('2026-12-03T07:30:00Z'), now, cfg).toISOString()).toBe('2026-12-03T03:30:00.000Z'); // 4h before the slot
    expect(preOrderAcceptBy(new Date('2026-12-01T09:00:00Z'), now, cfg).toISOString()).toBe('2026-12-01T06:20:00.000Z'); // booked 3h ahead: the normal 20 minutes
  });

  test('booking a pre-order: flag, slot stored, stock untouched, accept deadline relative to the slot, buyer pays only the fee now', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const k = await makeLiveKitchen(db, { societyId, qty: 10, price: 10000 });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    const when = day(2, 13);
    await setPlatformSetting('preOrdersEnabled', 'false');
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 2 }], fulfillmentType: 'self_pickup', scheduledFor: when })).rejects.toMatchObject({ status: 400 });
    await setPlatformSetting('preOrdersEnabled', 'true');
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 2 }], fulfillmentType: 'self_pickup', scheduledFor: when });
    const [o] = await db.select().from(s.orders).where(eq(s.orders.id, r.orderId));
    expect(o.scheduledSlot).toBe('lunch');
    expect(o.stockReserved).toBe(false);
    expect((await db.select().from(s.listings).where(eq(s.listings.id, k.dish.id)))[0].availableQty).toBe(10); // today's portions untouched
    expect(o.foodTotalInPaise).toBe(20000); // the food is still paid at the door
    await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
    const [paid] = await db.select().from(s.orders).where(eq(s.orders.id, r.orderId));
    expect(paid.status).toBe('booked');
    expect(paid.acceptBy!.getTime()).toBe(when.getTime() - 4 * 3_600_000); // 4h before the slot, not 20 minutes after booking
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, k.seller.id))).find((n) => n.eventKey === 'order_booked')!.body).toMatch(/scheduled for/);
    // a normal order placed now still gets the normal window
    const n = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    await markOrderPaid(n.orderId, { razorpayPaymentId: `pay_${n.orderId}` });
    const [normal] = await db.select().from(s.orders).where(eq(s.orders.id, n.orderId));
    expect(normal.acceptBy!.getTime() - normal.bookedAt!.getTime()).toBe(20 * 60_000);
    expect((await db.select().from(s.listings).where(eq(s.listings.id, k.dish.id)))[0].availableQty).toBe(9); // only the normal order took stock
  });

  test('slot capacity: orders per slot and portions per slot, per delivery date; another slot or day is free', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId, qty: 50, price: 10000 });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true, maxOrdersPerSlot: 2 }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await db.update(s.listings).set({ maxPortionsPerSlot: 3 }).where(eq(s.listings.id, k.dish.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    const book = (when: Date, qty: number) => createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty }], fulfillmentType: 'self_pickup', scheduledFor: when });
    const lunch = day(2, 13);
    await expect(book(lunch, 4)).rejects.toMatchObject({ status: 409 }); // more than 3 portions in one slot
    await book(lunch, 2);
    await expect(book(lunch, 2)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/fully booked for lunch/) }); // 2+2 > 3 portions
    await book(lunch, 1); // 3 portions in total, 2 orders
    await expect(book(lunch, 1)).rejects.toMatchObject({ status: 409 }); // the slot's order limit (2) is reached
    await book(day(2, 20), 3); // dinner the same day is free
    await book(day(3, 13), 3); // lunch the next day is free
  });

  test('provisional caps count on the DELIVERY day, not the booking day', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('provisionalMaxOrdersPerDay', '1');
    const k = await makeLiveKitchen(db, { societyId, qty: 50, fssai: 'provisional' });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true, maxOrdersPerSlot: 99 }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    const place = (when?: Date) => createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup', ...(when ? { scheduledFor: when } : {}) });
    await place(day(2, 13)); // books for the day after tomorrow
    await place(); // today's single order is still available: the pre-order did not use today's cap
    await expect(place()).rejects.toMatchObject({ status: 409 }); // today is now full
    await expect(place(day(2, 20))).rejects.toMatchObject({ status: 409 }); // the delivery day already has its one order
    await place(day(3, 13)); // another day is free
    await setPlatformSetting('provisionalMaxOrdersPerDay', '8');
  });

  test('closed today does not stop a pre-order for a later day; a missed accept deadline refunds the fee', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const { runOrderTimers } = await import('@/lib/orders/lifecycle');
    const k = await makeLiveKitchen(db, { societyId, qty: 50 });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true, closedUntil: new Date(Date.now() + 3_600_000) }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 400 });
    const when = day(2, 13);
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup', scheduledFor: when });
    await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
    await runOrderTimers(new Date(when.getTime() - 5 * 3_600_000)); // 5h before the slot: still waiting
    expect((await db.select().from(s.orders).where(eq(s.orders.id, r.orderId)))[0].status).toBe('booked');
    await runOrderTimers(new Date(when.getTime() - 3 * 3_600_000)); // past accept-by (4h before)
    const [after] = await db.select().from(s.orders).where(eq(s.orders.id, r.orderId));
    expect(after.status).toBe('cancelled_auto');
    expect(after.feeRefundedInPaise).toBeGreaterThan(0);
  });
});
