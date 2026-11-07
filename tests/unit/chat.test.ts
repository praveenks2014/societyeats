import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { call, jsonReq, loginAs } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
let admin: Awaited<ReturnType<typeof makeUser>>;
const H = 3_600_000;

beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db, { name: 'Lotus Heights' })).id;
  admin = await makeUser(db, 'admin');
  process.env.ADMIN_EMAILS = admin.email!;
});

async function setup() {
  const { createHomeOrder } = await import('@/lib/orders/create');
  const { markOrderPaid } = await import('@/lib/payments');
  const { resolveSession } = await import('@/lib/auth');
  const k = await makeLiveKitchen(db, { societyId, qty: 50 });
  const buyer = await makeUser(db, 'buyer', { societyId, name: 'Priya Sharma' });
  const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
  const sess = async (u: number) => {
    await loginAs(u);
    const rows = await db.select().from(s.sessions).where(eq(s.sessions.userId, u));
    return (await resolveSession(rows[rows.length - 1].id))!;
  };
  return { ...k, buyer, orderId: r.orderId, pay: () => markOrderPaid(r.orderId), sess };
}

describe('C2: access window and identities', () => {
  test('opens when booked (not before), shows first name + society, never surname/flat/phone, closes 48h after the order ends', async () => {
    const { readThread, postMessage, threadState } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    const buyerS = await o.sess(o.buyer.id);
    await expect(readThread(o.orderId, buyerS)).rejects.toMatchObject({ status: 404 }); // fee not paid yet
    await o.pay();
    const sellerS = await o.sess(o.seller.id);
    await postMessage(o.orderId, buyerS, { quickReplyKey: 'coming_down' });
    const r = await postMessage(o.orderId, sellerS, { body: 'No problem, see you soon' });
    expect(r.sent).toBe(true);
    const t = await readThread(o.orderId, buyerS);
    expect(t.messages.map((m) => m.label)).toEqual(['Priya · Lotus Heights', expect.stringMatching(/^Kitchen: /)]);
    const blob = JSON.stringify(t);
    expect(blob).not.toContain('Sharma');
    expect(blob).not.toContain(o.buyer.phone);
    expect(blob).not.toContain('B-1204');
    // window: 48 hours after completion, also after a cancellation
    const done = new Date('2026-01-01T00:00:00Z');
    expect(threadState({ status: 'completed', completedAt: done, updatedAt: done }, new Date(done.getTime() + 47 * H)).open).toBe(true);
    expect(threadState({ status: 'completed', completedAt: done, updatedAt: done }, new Date(done.getTime() + 49 * H)).open).toBe(false);
    expect(threadState({ status: 'cancelled_by_buyer', completedAt: null, cancelledAt: done, updatedAt: done }, new Date(done.getTime() + 49 * H)).open).toBe(false);
    expect(threadState({ status: 'booked', completedAt: null, updatedAt: done }, new Date(done.getTime() + 500 * H)).open).toBe(true);
    // a closed thread refuses new messages
    await db.update(s.orders).set({ status: 'completed', completedAt: new Date(Date.now() - 60 * H) }).where(eq(s.orders.id, o.orderId));
    await expect(postMessage(o.orderId, buyerS, { body: 'hello?' })).rejects.toMatchObject({ status: 409 });
  });

  test('a third party (IDOR) cannot read, post or stream', async () => {
    const { readThread, postMessage } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const stranger = await makeUser(db, 'buyer', { societyId });
    const strangerS = await o.sess(stranger.id);
    await expect(readThread(o.orderId, strangerS)).rejects.toMatchObject({ status: 404 });
    await expect(postMessage(o.orderId, strangerS, { body: 'hi' })).rejects.toMatchObject({ status: 404 });
    const { GET } = await import('@/app/api/orders/[id]/chat/stream/route');
    const res = await GET(new Request(`http://localhost/api/orders/${o.orderId}/chat/stream`), { params: Promise.resolve({ id: String(o.orderId) }) });
    expect(res.status).toBe(404);
  });

  test('admins cannot read through the normal API at all', async () => {
    const { readThread } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const adminS = await o.sess(admin.id);
    await expect(readThread(o.orderId, adminS)).rejects.toMatchObject({ status: 403 });
  });
});

describe('C3/C4: content and the soft filter', () => {
  test('quick replies are per role; unknown or wrong-role keys are refused', async () => {
    const { postMessage, QUICK_REPLIES } = await import('@/lib/messaging/order-thread');
    expect(QUICK_REPLIES.filter((q) => q.role === 'seller').map((q) => q.text)).toEqual(expect.arrayContaining(['Running 10 min late', 'At your gate', 'Ready for pickup']));
    expect(QUICK_REPLIES.filter((q) => q.role === 'buyer').map((q) => q.text)).toEqual(expect.arrayContaining(['Please leave at door', 'Coming down', 'Ring the bell']));
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    await expect(postMessage(o.orderId, buyerS, { quickReplyKey: 'at_gate' })).rejects.toMatchObject({ status: 400 }); // seller-only
    await expect(postMessage(o.orderId, buyerS, { quickReplyKey: 'nope' })).rejects.toMatchObject({ status: 400 });
  });

  test('phone numbers, links, payment requests and abuse WARN first; a second tap sends; length is capped', async () => {
    const { postMessage, readThread } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    for (const [text, kind] of [
      ['call me on 9876543210', 'phone'],
      ['see https://example.com/x', 'link'],
      ['please send ₹500 first', 'payment'],
      ['pay to ramesh@okhdfc', 'payment'],
      ['you b1tch', 'abuse'],
    ] as const) {
      const r = await postMessage(o.orderId, buyerS, { body: text });
      expect(r.sent, text).toBe(false);
      expect(r.sent === false && r.warnings.map((w) => w.kind), text).toContain(kind);
    }
    expect((await readThread(o.orderId, buyerS)).messages).toHaveLength(0); // nothing was sent while warned
    const ok = await postMessage(o.orderId, buyerS, { body: 'please send ₹500 first', confirmed: true });
    expect(ok.sent).toBe(true);
    const t = await readThread(o.orderId, buyerS);
    expect(t.messages[0].flags).toContain('payment_request');
    // clean messages are not warned; "Drumstick" is not abuse
    expect((await postMessage(o.orderId, buyerS, { body: 'Is the drumstick curry spicy?' })).sent).toBe(true);
    await expect(postMessage(o.orderId, buyerS, { body: 'x'.repeat(1001) })).rejects.toMatchObject({ status: 400 });
    expect((await postMessage(o.orderId, buyerS, { body: 'y'.repeat(1000) })).sent).toBe(true);
  });

  test('a payment request before the door is flagged to the recipient (pay-at-door reminder), after the door it is not', async () => {
    const { postMessage, readThread } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    const sellerS = await o.sess(o.seller.id);
    await postMessage(o.orderId, sellerS, { body: 'please pay ₹200 to my number now', confirmed: true });
    const t = await readThread(o.orderId, buyerS);
    expect(t.preDoor).toBe(true);
    expect(t.messages[0].flags).toContain('payment_request');
    await db.update(s.orders).set({ status: 'at_door' }).where(eq(s.orders.id, o.orderId));
    expect((await readThread(o.orderId, buyerS)).preDoor).toBe(false);
  });

  test('images: need the setting, must be the sender\'s own chat_image upload, one use only', async () => {
    const { postMessage, readThread } = await import('@/lib/messaging/order-thread');
    const { saveUpload } = await import('@/lib/storage/files');
    const { setStorageForTests } = await import('@/lib/storage');
    const { MemoryStorage } = await import('@/lib/storage/memory');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    setStorageForTests(new MemoryStorage());
    const sharp = (await import('sharp')).default;
    const jpg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa5500' } }).jpeg().toBuffer();
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    const own = await saveUpload({ ownerId: o.buyer.id, purpose: 'chat_image', buffer: jpg, visibility: 'private', allowed: ['image'] });
    const others = await saveUpload({ ownerId: o.seller.id, purpose: 'chat_image', buffer: jpg, visibility: 'private', allowed: ['image'] });
    const wrongPurpose = await saveUpload({ ownerId: o.buyer.id, purpose: 'dish', buffer: jpg, visibility: 'public', allowed: ['image'] });
    await expect(postMessage(o.orderId, buyerS, { imageKey: others.key })).rejects.toMatchObject({ status: 400 });
    await expect(postMessage(o.orderId, buyerS, { imageKey: wrongPurpose.key })).rejects.toMatchObject({ status: 400 });
    const sent = await postMessage(o.orderId, buyerS, { imageKey: own.key, body: 'the packet' });
    expect(sent.sent).toBe(true);
    expect((await readThread(o.orderId, buyerS)).messages[0].imageUrl).toBe(`/api/files/${own.key}`);
    await expect(postMessage(o.orderId, buyerS, { imageKey: own.key })).rejects.toMatchObject({ status: 400 }); // reuse
    await setPlatformSetting('chatImagesEnabled', 'false');
    const second = await saveUpload({ ownerId: o.buyer.id, purpose: 'chat_image', buffer: jpg, visibility: 'private', allowed: ['image'] });
    await expect(postMessage(o.orderId, buyerS, { imageKey: second.key })).rejects.toMatchObject({ status: 400 });
    await setPlatformSetting('chatImagesEnabled', 'true');
    // the file is private: the other participant may view it, a stranger and an admin (no dispute) may not
    const { canViewPrivateFile } = await import('@/lib/storage/access');
    const { registerChatFileAccess } = await import('@/lib/chat/file-access');
    registerChatFileAccess();
    const row = (await db.select().from(s.files).where(eq(s.files.key, own.key)))[0];
    const sellerSess = await o.sess(o.seller.id);
    const stranger = await o.sess((await makeUser(db, 'buyer', { societyId })).id);
    const adminSess = await o.sess(admin.id);
    expect(await canViewPrivateFile(sellerSess, row)).toBe(true);
    expect(await canViewPrivateFile(stranger, row)).toBe(false);
    expect(await canViewPrivateFile(adminSess, row)).toBe(false);
    setStorageForTests(undefined);
  });

  test('the 2 MB limit for chat photos is enforced at upload', async () => {
    const { POST } = await import('@/app/api/uploads/route');
    const o = await setup();
    await loginAs(o.buyer.id);
    const big = new Uint8Array(2 * 1024 * 1024 + 10);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    const fd = new FormData();
    fd.append('file', new File([big], 'a.jpg', { type: 'image/jpeg' }));
    fd.append('purpose', 'chat_image');
    const r = await call(POST, new NextRequest('http://localhost/api/uploads', { method: 'POST', body: fd }));
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/2 MB/);
  });
});

describe('C1: unread counts, ETag, SSE', () => {
  test('unread per order and in total; reading clears it', async () => {
    const { postMessage, readThread, unreadCounts } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    const sellerS = await o.sess(o.seller.id);
    await postMessage(o.orderId, sellerS, { quickReplyKey: 'at_gate' });
    await postMessage(o.orderId, sellerS, { body: 'Outside now' });
    expect((await unreadCounts(o.buyer.id)).byOrder[o.orderId]).toBe(2);
    expect((await unreadCounts(o.seller.id)).byOrder[o.orderId] ?? 0).toBe(0); // my own messages are not unread for me
    await readThread(o.orderId, buyerS, { markRead: false });
    expect((await unreadCounts(o.buyer.id)).byOrder[o.orderId]).toBe(2); // plain reads do not clear
    await readThread(o.orderId, buyerS, { markRead: true });
    expect((await unreadCounts(o.buyer.id)).total).toBe(0);
    await postMessage(o.orderId, sellerS, { body: 'One more' });
    expect((await unreadCounts(o.buyer.id)).total).toBe(1);
  });

  test('GET returns an ETag; an unchanged thread is a 304, a new message is not', async () => {
    const { GET } = await import('@/app/api/orders/[id]/messages/route');
    const { postMessage } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    await postMessage(o.orderId, buyerS, { quickReplyKey: 'ring_bell' });
    await loginAs(o.buyer.id);
    const mk = (etag?: string) => new NextRequest(`http://localhost/api/orders/${o.orderId}/messages`, { headers: etag ? { 'if-none-match': etag } : {} });
    const first = (await GET(mk(), { params: Promise.resolve({ id: String(o.orderId) }) } as never)) as Response;
    const tag = first.headers.get('etag')!;
    expect(tag).toMatch(/^W\//);
    expect(((await GET(mk(tag), { params: Promise.resolve({ id: String(o.orderId) }) } as never)) as Response).status).toBe(304);
    await postMessage(o.orderId, await o.sess(o.seller.id), { body: 'Thanks!' });
    await loginAs(o.buyer.id);
    const after = (await GET(mk(tag), { params: Promise.resolve({ id: String(o.orderId) }) } as never)) as Response;
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(tag);
  });

  test('SSE: sends a retry hint, resumes from Last-Event-ID without repeats, and ends when the client goes away', async () => {
    const { GET } = await import('@/app/api/orders/[id]/chat/stream/route');
    const { postMessage } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    const sellerS = await o.sess(o.seller.id);
    const m1 = await postMessage(o.orderId, sellerS, { body: 'first' });
    const m2 = await postMessage(o.orderId, sellerS, { body: 'second' });
    if (!m1.sent || !m2.sent) throw new Error('send failed');
    await loginAs(o.buyer.id);
    const ac = new AbortController();
    const res = await GET(new Request(`http://localhost/api/orders/${o.orderId}/chat/stream`, { headers: { 'last-event-id': String(m1.message.id) }, signal: ac.signal }), { params: Promise.resolve({ id: String(o.orderId) }) });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    let text = '';
    const dec = new TextDecoder();
    const t0 = Date.now();
    while (!text.includes('second') && Date.now() - t0 < 5000) {
      const { value } = await reader.read();
      text += dec.decode(value);
    }
    ac.abort();
    expect(text).toContain('retry: 3000');
    expect(text).toContain(`id: ${m2.message.id}`);
    expect(text).toContain('second');
    expect(text).not.toContain('first'); // resumed after m1
    void buyerS;
  });
});

describe('C4: report, block, phone share', () => {
  test('reporting a message opens one grievance ticket with the message ids; a repeat does not duplicate', async () => {
    const { postMessage, reportMessage, reportUser } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    const sellerS = await o.sess(o.seller.id);
    const sent = await postMessage(o.orderId, sellerS, { body: 'rude thing', confirmed: true });
    if (!sent.sent) throw new Error('x');
    const first = await reportMessage(o.orderId, buyerS, sent.message.id);
    expect(first.grievanceId).toBeTruthy();
    const second = await reportMessage(o.orderId, buyerS, sent.message.id);
    expect(second.grievanceId).toBeNull();
    const [g] = await db.select().from(s.grievances).where(eq(s.grievances.id, first.grievanceId!));
    expect(g).toMatchObject({ kind: 'chat_report', orderId: o.orderId, raisedById: o.buyer.id });
    expect((g.evidenceJson as { messageIds: number[] }).messageIds).toEqual([sent.message.id]);
    await expect(reportMessage(o.orderId, sellerS, sent.message.id)).rejects.toMatchObject({ status: 400 }); // own message
    const u = await reportUser(o.orderId, buyerS, 'abusive');
    expect(u.grievanceId).toBeTruthy();
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, admin.id))).some((n) => /Chat reported/.test(n.title))).toBe(true);
  });

  test('blocking stops messages and new orders from that buyer to that kitchen', async () => {
    const { postMessage, blockOther } = await import('@/lib/messaging/order-thread');
    const { createHomeOrder } = await import('@/lib/orders/create');
    const o = await setup();
    await o.pay();
    const sellerS = await o.sess(o.seller.id);
    const buyerS = await o.sess(o.buyer.id);
    await blockOther(o.orderId, sellerS);
    await expect(postMessage(o.orderId, buyerS, { body: 'hello?' })).rejects.toMatchObject({ status: 403 });
    await expect(createHomeOrder({ buyerId: o.buyer.id, sellerId: o.seller.id, items: [{ id: o.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 403 });
    // another buyer is unaffected
    const other = await makeUser(db, 'buyer', { societyId });
    await expect(createHomeOrder({ buyerId: other.id, sellerId: o.seller.id, items: [{ id: o.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).resolves.toBeTruthy();
  });

  test('phone number is shown to the other person only while its owner has switched sharing on', async () => {
    const { readThread, setPhoneShare } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const buyerS = await o.sess(o.buyer.id);
    const sellerS = await o.sess(o.seller.id);
    expect((await readThread(o.orderId, sellerS)).phone.theirs).toBeNull();
    await setPhoneShare(o.orderId, buyerS, true);
    expect((await readThread(o.orderId, sellerS)).phone.theirs).toBe(o.buyer.phone);
    expect((await readThread(o.orderId, buyerS)).phone).toEqual({ mine: true, theirs: null });
    await setPhoneShare(o.orderId, buyerS, false);
    expect((await readThread(o.orderId, sellerS)).phone.theirs).toBeNull();
  });
});

describe('C2: admin reads are gated, justified and logged', () => {
  test('refused without a dispute; allowed with one; needs a reason and fresh 2FA; logged with the reason', async () => {
    const { POST, GET } = await import('@/app/api/admin/chat/[orderId]/route');
    const { postMessage } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    await postMessage(o.orderId, await o.sess(o.buyer.id), { body: 'hello kitchen' });
    const params = { orderId: String(o.orderId) };
    await loginAs(admin.id);
    expect((await call(GET, jsonReq('/x', undefined, { method: 'GET' }), params)).json).toEqual({ mayRead: false });
    expect((await call(POST, jsonReq('/x', { reason: 'checking for the dispute' }), params)).status).toBe(403);
    await db.insert(s.grievances).values({ kind: 'dispute_payment', orderId: o.orderId, subject: 'x', ackDueAt: new Date(), resolveDueAt: new Date() });
    expect((await call(POST, jsonReq('/x', { reason: '' }), params)).status).toBe(400);
    await loginAs(admin.id, { mfa: false });
    expect((await call(POST, jsonReq('/x', { reason: 'payment dispute #1' }), params)).status).toBeGreaterThanOrEqual(401);
    await loginAs(admin.id);
    const r = await call(POST, jsonReq('/x', { reason: 'payment dispute #1' }), params);
    expect(r.status).toBe(200);
    expect((r.json.messages as { body: string }[]).map((m) => m.body)).toEqual(['hello kitchen']);
    const logs = (await db.select().from(s.auditLog)).filter((a) => a.action === 'chat.admin_read' && a.targetId === String(o.orderId));
    expect(logs).toHaveLength(1);
    expect((logs[0].meta as { reason: string }).reason).toBe('payment dispute #1');
  });

  test('a reported message alone also opens the chat to admins', async () => {
    const { adminMayRead, postMessage, reportMessage } = await import('@/lib/messaging/order-thread');
    const o = await setup();
    await o.pay();
    const sent = await postMessage(o.orderId, await o.sess(o.seller.id), { body: 'hi' });
    if (!sent.sent) throw new Error('x');
    expect(await adminMayRead(o.orderId)).toBe(false);
    await reportMessage(o.orderId, await o.sess(o.buyer.id), sent.message.id);
    expect(await adminMayRead(o.orderId)).toBe(true);
  });
});
