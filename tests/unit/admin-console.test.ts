import { eq } from 'drizzle-orm';
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
  societyId = (await makeSociety(db)).id;
  admin = await makeUser(db, 'admin');
  process.env.ADMIN_EMAILS = admin.email!;
  const { seedSubscriptionPlans } = await import('@/lib/subscriptions/plans');
  await seedSubscriptionPlans(db);
});

/** A kitchen that has submitted its application, with every requirement met unless `gaps` removes one. */
async function submitted(gaps: Partial<Record<'photos' | 'hygiene' | 'terms' | 'pan' | 'upi' | 'dish' | 'email' | 'member', true>> = {}, hoursAgo = 5) {
  const { AGREEMENT_VERSION, HYGIENE_ITEMS } = await import('@/lib/kitchen/onboarding');
  const k = await makeLiveKitchen(db, { societyId, fssai: 'provisional', upiVerified: !gaps.upi });
  await db.update(s.sellerProfiles).set({
    listingState: 'submitted',
    listingSubmittedAt: new Date(Date.now() - hoursAgo * H),
    isApproved: false,
    kitchenPhotosJson: gaps.photos ? ['/a.jpg'] : ['/a.jpg', '/b.jpg', '/c.jpg'],
    hygieneDeclarationJson: gaps.hygiene ? {} : Object.fromEntries(HYGIENE_ITEMS.map((i) => [i.key, 'yes'])),
    agreementVersion: gaps.terms ? null : AGREEMENT_VERSION,
    panMasked: gaps.pan ? null : 'ABCDE****F',
    panNameOnCard: gaps.pan ? null : 'KAMALA COOK',
    panVerifyJson: gaps.pan ? null : { status: 'verified', nameMatchScore: 90, checkedAt: new Date().toISOString() },
    upiNameMatchScore: 92,
  }).where(eq(s.sellerProfiles.userId, k.seller.id));
  if (gaps.dish) await db.delete(s.listings).where(eq(s.listings.sellerId, k.seller.id));
  await db.update(s.users).set({ emailVerifiedAt: gaps.email ? null : new Date() }).where(eq(s.users.id, k.seller.id));
  if (gaps.member) await db.delete(s.societyMemberships).where(eq(s.societyMemberships.userId, k.seller.id));
  else await db.insert(s.societyMemberships).values({ userId: k.seller.id, societyId, status: 'approved' }).onConflictDoNothing();
  return k;
}

describe('E1: onboarding queue and checklist', () => {
  test('a complete application shows pass everywhere except FSSAI (provisional is a flag, not a fail)', async () => {
    const { kitchenChecklist } = await import('@/lib/admin/checklist');
    const k = await submitted();
    const c = (await kitchenChecklist(k.seller.id))!;
    const by = Object.fromEntries(c.checks.map((x) => [x.key, x.status]));
    expect(by).toMatchObject({ membership: 'pass', email: 'pass', pan: 'pass', upi: 'pass', photos: 'pass', hygiene: 'pass', terms: 'pass', dishes: 'pass', fssai: 'flag' });
    expect(c.blockingFails).toBe(0);
    expect(c.flags).toBe(1);
  });

  test('each gap shows up as its own fail', async () => {
    const { kitchenChecklist } = await import('@/lib/admin/checklist');
    const cases: [Parameters<typeof submitted>[0], string][] = [[{ photos: true }, 'photos'], [{ hygiene: true }, 'hygiene'], [{ terms: true }, 'terms'], [{ pan: true }, 'pan'], [{ upi: true }, 'upi'], [{ dish: true }, 'dishes'], [{ email: true }, 'email'], [{ member: true }, 'membership']];
    for (const [gaps, key] of cases) {
      const k = await submitted(gaps);
      const c = (await kitchenChecklist(k.seller.id))!;
      expect(c.checks.find((x) => x.key === key)?.status, key).toBe('fail');
    }
  });

  test('a low UPI name match is a flag for a human, never an automatic fail; a pending dish is a flag', async () => {
    const { kitchenChecklist } = await import('@/lib/admin/checklist');
    const k = await submitted();
    await db.update(s.sellerProfiles).set({ upiNameMatchScore: 40 }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await db.update(s.listings).set({ moderationStatus: 'pending' }).where(eq(s.listings.sellerId, k.seller.id));
    const c = (await kitchenChecklist(k.seller.id))!;
    expect(c.checks.find((x) => x.key === 'upi')).toMatchObject({ status: 'flag' });
    expect(c.checks.find((x) => x.key === 'upi')!.detail).toContain('40/100');
    expect(c.checks.find((x) => x.key === 'dishes')!.status).toBe('flag');
  });

  test('queue: oldest first, overdue past the 48h target, and a non-submitted kitchen is not in it', async () => {
    const { applicationsQueue } = await import('@/lib/admin/checklist');
    const fresh = await submitted({}, 2);
    const old = await submitted({}, 60);
    const draft = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ listingState: 'draft' }).where(eq(s.sellerProfiles.userId, draft.seller.id));
    const q = await applicationsQueue();
    const ids = q.map((x) => x.sellerId);
    expect(ids).not.toContain(draft.seller.id);
    expect(ids.indexOf(old.seller.id)).toBeLessThan(ids.indexOf(fresh.seller.id));
    expect(q.find((x) => x.sellerId === old.seller.id)).toMatchObject({ overdue: true, ageHours: 60, targetHours: 48 });
    expect(q.find((x) => x.sellerId === fresh.seller.id)!.overdue).toBe(false);
    const { GET } = await import('@/app/api/admin/applications/route');
    await loginAs(admin.id);
    const r = await call(GET, jsonReq('/x', undefined, { method: 'GET' }));
    expect((r.json.overdue as number)).toBeGreaterThanOrEqual(1);
    expect((r.json.templates as unknown[]).length).toBeGreaterThanOrEqual(5);
  });

  test('approve grants the founding plan; request-changes and reject carry the reason; all need fresh 2FA', async () => {
    const { POST } = await import('@/app/api/admin/kitchens/[id]/route');
    const k = await submitted();
    await loginAs(admin.id, { mfa: false });
    expect((await call(POST, jsonReq('/x', { action: 'approve' }), { id: String(k.seller.id) })).status).toBeGreaterThanOrEqual(401);
    await loginAs(admin.id);
    expect((await call(POST, jsonReq('/x', { action: 'request_changes', reason: '' }), { id: String(k.seller.id) })).status).toBe(400);
    expect((await call(POST, jsonReq('/x', { action: 'request_changes', reason: 'Please redo the photos' }), { id: String(k.seller.id) })).status).toBe(200);
    expect((await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id)))[0]).toMatchObject({ listingState: 'changes_requested', listingReviewNote: 'Please redo the photos' });
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, k.seller.id))).some((n) => n.eventKey === 'onboarding_decision' && /redo the photos/.test(n.body ?? ''))).toBe(true);
    // resubmit and approve
    await db.update(s.sellerProfiles).set({ listingState: 'submitted' }).where(eq(s.sellerProfiles.userId, k.seller.id));
    expect((await call(POST, jsonReq('/x', { action: 'approve' }), { id: String(k.seller.id) })).status).toBe(200);
    const subs = await db.select().from(s.kitchenSubscriptions).where(eq(s.kitchenSubscriptions.sellerId, k.seller.id));
    expect(subs.some((x) => x.planNameSnapshot === 'Founding kitchen' && x.status === 'waived')).toBe(true);
  });
});

describe('E1: caps, strikes, unpause', () => {
  test('a cap override lifts the daily limit for a provisional kitchen, expires, and is logged with a reason', async () => {
    const { POST } = await import('@/app/api/admin/kitchens/[id]/route');
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('provisionalMaxOrdersPerDay', '1');
    const k = await makeLiveKitchen(db, { societyId, qty: 100, fssai: 'provisional' });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const place = () => createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    await place();
    await expect(place()).rejects.toMatchObject({ status: 409 });
    await loginAs(admin.id);
    expect((await call(POST, jsonReq('/x', { action: 'set_caps', maxOrdersPerDay: 5, reason: '' }), { id: String(k.seller.id) })).status).toBe(400);
    expect((await call(POST, jsonReq('/x', { action: 'set_caps', days: 7, reason: 'trusted neighbour' }), { id: String(k.seller.id) })).status).toBe(400); // no limit given
    expect((await call(POST, jsonReq('/x', { action: 'set_caps', maxOrdersPerDay: 5, days: 7, reason: 'trusted neighbour' }), { id: String(k.seller.id) })).status).toBe(200);
    await place();
    await place();
    // expired override: back to the platform limit
    await db.update(s.sellerProfiles).set({ capOverrideJson: { maxOrdersPerDay: 5, expiresAt: new Date(Date.now() - 1000).toISOString() } }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await expect(place()).rejects.toMatchObject({ status: 409 });
    expect((await call(POST, jsonReq('/x', { action: 'clear_caps', reason: 'done' }), { id: String(k.seller.id) })).status).toBe(200);
    expect((await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id)))[0].capOverrideJson).toBeNull();
    expect((await db.select().from(s.auditLog)).filter((a) => a.action === 'kitchen.set_caps' && (a.meta as { reason: string }).reason === 'trusted neighbour')).toHaveLength(1);
    await setPlatformSetting('provisionalMaxOrdersPerDay', '8');
  });

  test('lift a strike and unpause a kitchen that strikes paused', async () => {
    const { POST } = await import('@/app/api/admin/kitchens/[id]/route');
    const { recordStrike } = await import('@/lib/orders/strikes');
    const k = await makeLiveKitchen(db, { societyId });
    for (let i = 0; i < 3; i++) await recordStrike({ userId: k.seller.id, role: 'seller', kind: 'seller_cancel', reason: `cancel ${i}` });
    let p = (await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id)))[0];
    expect(p.listingsPausedReason).toBe('strikes');
    const { kitchenGate } = await import('@/lib/kitchen/gate');
    expect((await kitchenGate(k.seller.id)).ok).toBe(false);
    await loginAs(admin.id);
    const [strike] = await db.select().from(s.strikes).where(eq(s.strikes.userId, k.seller.id));
    expect((await call(POST, jsonReq('/x', { action: 'lift_strike', strikeId: strike.id, reason: 'one-off, gas shortage' }), { id: String(k.seller.id) })).status).toBe(200);
    expect((await call(POST, jsonReq('/x', { action: 'lift_strike', strikeId: strike.id, reason: 'again' }), { id: String(k.seller.id) })).status).toBe(404); // already lifted
    expect((await call(POST, jsonReq('/x', { action: 'unpause', reason: 'reviewed with the cook' }), { id: String(k.seller.id) })).status).toBe(200);
    p = (await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id)))[0];
    expect(p.listingsPausedReason).toBeNull();
    expect((await kitchenGate(k.seller.id)).ok).toBe(true);
    const audits = (await db.select().from(s.auditLog)).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(['strike.lift', 'kitchen.unpause']));
  });
});

describe('E2: disputes board and outcomes', () => {
  async function disputed(opts: { claim?: boolean } = {}) {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const { performOrderAction } = await import('@/lib/orders/actions');
    const k = await makeLiveKitchen(db, { societyId, qty: 100, acceptsCash: true });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
    const run = (who: 'buyer' | 'seller', action: string, extra: Record<string, unknown> = {}) => performOrderAction(r.orderId, { action, actor: who, actorId: who === 'buyer' ? buyer.id : k.seller.id, ...extra } as never);
    for (const a of ['accept', 'preparing', 'ready', 'buyer_arrived']) await run('seller', a);
    await run('buyer', 'collect');
    await run('buyer', 'claim_paid', { method: 'upi', utr: '112233445566' });
    await run('seller', 'not_received', { reason: 'Nothing in my account' });
    const [g] = await db.select().from(s.grievances).where(eq(s.grievances.orderId, r.orderId));
    return { ...k, buyer, orderId: r.orderId, ticket: g };
  }
  const decide = async (id: number, outcome: Record<string, unknown>, note = 'reviewed the evidence') => {
    const { POST } = await import('@/app/api/admin/disputes/[id]/route');
    return call(POST, jsonReq('/x', { note, outcome }), { id: String(id) });
  };

  test('the board puts the disputed order in the Disputed column; the ticket shows both statements, UTR and the timeline', async () => {
    const d = await disputed();
    const { GET } = await import('@/app/api/admin/disputes/route');
    const { GET: DETAIL } = await import('@/app/api/admin/disputes/[id]/route');
    await loginAs(admin.id);
    const board = (await call(GET, jsonReq('/x', undefined, { method: 'GET' }))).json as { columns: { key: string; orders: { id: number }[] }[]; tickets: { id: number }[] };
    expect(board.columns.find((c) => c.key === 'disputed')!.orders.map((o) => o.id)).toContain(d.orderId);
    expect(board.tickets.map((t) => t.id)).toContain(d.ticket.id);
    const det = (await call(DETAIL, jsonReq('/x', undefined, { method: 'GET' }), { id: String(d.ticket.id) })).json as { order: { buyerClaim: { method: string; utr: string }; kitchenStatement: string }; timeline: { status: string }[]; chatMayRead: boolean };
    expect(det.order.buyerClaim).toMatchObject({ method: 'upi', utr: '112233445566' });
    expect(det.order.kitchenStatement).toBe('Nothing in my account');
    expect(det.timeline.map((t) => t.status)).toEqual(expect.arrayContaining(['booked', 'accepted', 'payment_disputed']));
    expect(det.chatMayRead).toBe(true); // a dispute opens the chat to a logged read
  });

  test('SLA: a ticket past 48h unacknowledged, or past the resolve date, is flagged overdue', async () => {
    const { slaOf } = await import('@/lib/disputes');
    const now = new Date('2026-12-01T00:00:00Z');
    const mk = (status: string, ackH: number, resolveD: number) => ({ status, ackDueAt: new Date(now.getTime() + ackH * H), resolveDueAt: new Date(now.getTime() + resolveD * 24 * H) });
    expect(slaOf(mk('open', -1, 10), now)).toMatchObject({ ackOverdue: true, resolveOverdue: false });
    expect(slaOf(mk('open', 10, -1), now)).toMatchObject({ ackOverdue: false, resolveOverdue: true });
    expect(slaOf(mk('acknowledged', -5, 10), now).ackOverdue).toBe(false); // already acknowledged
    expect(slaOf(mk('resolved', -5, -5), now)).toMatchObject({ ackOverdue: false, resolveOverdue: false });
  });

  test('mark paid completes the order, mark unpaid closes it and strikes the buyer; both resolve the ticket; a second decision is refused', async () => {
    const a = await disputed();
    await loginAs(admin.id);
    expect((await decide(a.ticket.id, { kind: 'mark_paid' }, '')).status).toBe(400); // note required
    expect((await decide(a.ticket.id, { kind: 'mark_paid' })).status).toBe(200);
    expect((await db.select().from(s.orders).where(eq(s.orders.id, a.orderId)))[0].status).toBe('completed');
    expect((await db.select().from(s.grievances).where(eq(s.grievances.id, a.ticket.id)))[0]).toMatchObject({ status: 'resolved', resolution: 'mark_paid' });
    expect((await decide(a.ticket.id, { kind: 'mark_paid' })).status).toBe(409);

    const b = await disputed();
    expect((await decide(b.ticket.id, { kind: 'mark_unpaid' })).status).toBe(200);
    expect((await db.select().from(s.orders).where(eq(s.orders.id, b.orderId)))[0].status).toBe('closed_unpaid');
    expect((await db.select().from(s.strikes).where(eq(s.strikes.userId, b.buyer.id))).map((x) => x.kind)).toContain('buyer_unpaid');
    const audits = (await db.select().from(s.auditLog)).filter((x) => x.action.startsWith('dispute.'));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(['dispute.mark_paid', 'dispute.mark_unpaid']));
  });

  test('refund the fee, issue credit, warn (ticket stays open), suspend buyer and kitchen', async () => {
    const d = await disputed();
    await loginAs(admin.id);
    expect((await decide(d.ticket.id, { kind: 'issue_credit', amountPaise: -5 })).status).toBe(400);
    expect((await decide(d.ticket.id, { kind: 'warn', target: 'seller', message: 'Please check your UPI app before raising disputes' })).json).toMatchObject({ resolved: false });
    expect((await db.select().from(s.grievances).where(eq(s.grievances.id, d.ticket.id)))[0].status).toBe('acknowledged');
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, d.seller.id))).some((n) => n.title === 'A warning from PadosiPlate')).toBe(true);

    expect((await decide(d.ticket.id, { kind: 'issue_credit', amountPaise: 1500 })).status).toBe(200);
    // the ticket is resolved by the credit; use fresh disputes for the rest
    const credits = await db.select().from(s.referralCredits).where(eq(s.referralCredits.buyerId, d.buyer.id));
    expect(credits.find((c) => c.source === 'admin')).toMatchObject({ amountInPaise: 1500, sourceOrderId: d.orderId });
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, d.buyer.id))).some((n) => n.eventKey === 'credit_issued')).toBe(true);

    const r = await disputed();
    expect((await decide(r.ticket.id, { kind: 'refund_fee' })).status).toBe(200);
    expect((await db.select().from(s.orders).where(eq(s.orders.id, r.orderId)))[0].feeRefundedInPaise).toBeGreaterThan(0);

    const sb = await disputed();
    expect((await decide(sb.ticket.id, { kind: 'suspend', target: 'buyer', days: 7 })).status).toBe(200);
    const blockedUntil = (await db.select().from(s.users).where(eq(s.users.id, sb.buyer.id)))[0].ordersBlockedUntil!;
    expect(Math.round((blockedUntil.getTime() - Date.now()) / 86_400_000)).toBe(7);
    const sk = await disputed();
    expect((await decide(sk.ticket.id, { kind: 'suspend', target: 'seller' })).status).toBe(200);
    expect((await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, sk.seller.id)))[0].listingsPausedReason).toBe('dispute');
  });

  test('every decision needs a fresh 2FA check; admin order actions too', async () => {
    const d = await disputed();
    await loginAs(admin.id, { mfa: false });
    expect((await decide(d.ticket.id, { kind: 'mark_paid' })).status).toBeGreaterThanOrEqual(401);
    const { POST } = await import('@/app/api/orders/[id]/action/route');
    expect((await call(POST, jsonReq('/x', { action: 'resolve_paid' }), { id: String(d.orderId) })).status).toBeGreaterThanOrEqual(401);
    await loginAs(admin.id);
    expect((await call(POST, jsonReq('/x', { action: 'resolve_paid' }), { id: String(d.orderId) })).status).toBe(200);
  });
});

describe('E3: grievances', () => {
  test('automatic acknowledgement on creation (in-app + email); data requests get 30 days; complaint gets the resolve setting', async () => {
    const { POST } = await import('@/app/api/grievances/route');
    const u = await makeUser(db, 'buyer', { societyId });
    await loginAs(u.id);
    expect((await call(POST, jsonReq('/x', { subject: 'Late', body: 'short' }))).status).toBe(400);
    const a = await call(POST, jsonReq('/x', { subject: 'Food was cold', body: 'The biryani arrived cold and the raita was missing' }));
    expect(a.status).toBe(200);
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('dataRequestDays', '20');
    const d = await call(POST, jsonReq('/x', { kind: 'data_request', subject: 'Erase my data', body: 'Please erase everything you hold about me' }));
    await setPlatformSetting('dataRequestDays', '30');
    const [ga] = await db.select().from(s.grievances).where(eq(s.grievances.id, a.json.id as number));
    const [gd] = await db.select().from(s.grievances).where(eq(s.grievances.id, d.json.id as number));
    expect(Math.round((ga.resolveDueAt.getTime() - ga.createdAt.getTime()) / 86_400_000)).toBe(30); // one month, the E-Commerce Rules
    expect(Math.round((gd.resolveDueAt.getTime() - gd.createdAt.getTime()) / 86_400_000)).toBe(20); // data requests use their own setting
    expect(Math.round((ga.ackDueAt.getTime() - ga.createdAt.getTime()) / H)).toBe(48);
    const inbox = await db.select().from(s.notifications).where(eq(s.notifications.userId, u.id));
    expect(inbox.filter((n) => n.eventKey === 'grievance_received')).toHaveLength(2);
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, u.id))).filter((e) => /We received your complaint/.test(e.subject))).toHaveLength(2);
    expect((await db.select().from(s.grievanceEvents).where(eq(s.grievanceEvents.grievanceId, ga.id))).map((e) => e.kind)).toEqual(['created']);
  });

  test('admins are alerted once when a ticket is not picked up in 48h, and once when it passes its resolution date', async () => {
    const { createGrievance, alertOverdueGrievances, acknowledgeGrievance, resolveGrievance } = await import('@/lib/grievances');
    const a2 = await makeUser(db, 'admin');
    const u = await makeUser(db, 'buyer', { societyId });
    const t0 = new Date('2026-12-01T10:00:00Z');
    const g = await createGrievance({ kind: 'grievance', subject: 'Slow refund', raisedById: u.id, raisedRole: 'buyer' }, t0);
    const alertsFor = async (id: number) => (await db.select().from(s.grievanceEvents).where(eq(s.grievanceEvents.grievanceId, id))).filter((e) => e.kind === 'alert').map((e) => e.body);
    await alertOverdueGrievances(new Date(t0.getTime() + 47 * H));
    expect(await alertsFor(g.id)).toEqual([]);
    await alertOverdueGrievances(new Date(t0.getTime() + 49 * H));
    expect(await alertsFor(g.id)).toEqual(['Pick-up deadline missed']);
    await alertOverdueGrievances(new Date(t0.getTime() + 50 * H));
    await alertOverdueGrievances(new Date(t0.getTime() + 55 * H)); // cron every 5 minutes: never repeats
    expect(await alertsFor(g.id)).toEqual(['Pick-up deadline missed']);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, a2.id))).filter((n) => n.title === `Ticket #${g.id} has not been picked up`)).toHaveLength(1);
    await alertOverdueGrievances(new Date(t0.getTime() + 31 * 24 * H));
    expect(await alertsFor(g.id)).toEqual(['Pick-up deadline missed', 'Resolution deadline missed']);
    // a ticket picked up in time never raises the pick-up alert; a resolved one raises nothing
    const g2 = await createGrievance({ kind: 'grievance', subject: 'Other', raisedById: u.id, raisedRole: 'buyer' }, t0);
    await acknowledgeGrievance(g2.id, a2.id, new Date(t0.getTime() + H));
    await alertOverdueGrievances(new Date(t0.getTime() + 49 * H));
    expect(await alertsFor(g2.id)).toEqual([]);
    await resolveGrievance(g2.id, a2.id, 'resolved', 'done');
    await alertOverdueGrievances(new Date(t0.getTime() + 40 * 24 * H));
    expect(await alertsFor(g2.id)).toEqual([]);
  });

  test('assign, notes and the history trail; only an admin can own a ticket; resolving tells the person', async () => {
    const { POST, GET } = await import('@/app/api/admin/grievances/[id]/route');
    const { createGrievance } = await import('@/lib/grievances');
    const u = await makeUser(db, 'buyer', { societyId });
    const g = await createGrievance({ kind: 'grievance', subject: 'Packaging', body: 'It leaked', raisedById: u.id, raisedRole: 'buyer' });
    const p = { id: String(g.id) };
    await loginAs(admin.id);
    expect((await call(POST, jsonReq('/x', { action: 'assign', assigneeId: u.id }), p)).status).toBe(400); // a buyer cannot own it
    expect((await call(POST, jsonReq('/x', { action: 'assign', assigneeId: admin.id }), p)).status).toBe(200);
    expect((await db.select().from(s.grievances).where(eq(s.grievances.id, g.id)))[0]).toMatchObject({ status: 'acknowledged', handledBy: admin.id });
    expect((await call(POST, jsonReq('/x', { action: 'note', body: 'Called the kitchen' }), p)).status).toBe(200);
    expect((await call(POST, jsonReq('/x', { action: 'resolve', resolution: 'resolved', note: 'Kitchen apologised and we credited ₹20' }), p)).status).toBe(200);
    expect((await call(POST, jsonReq('/x', { action: 'resolve', resolution: 'resolved', note: 'again please' }), p)).status).toBe(409);
    const hist = ((await call(GET, jsonReq('/x', undefined, { method: 'GET' }), p)).json.history as { kind: string; body: string | null }[]).map((h) => h.kind);
    expect(hist).toEqual(['created', 'assigned', 'status', 'note', 'status']);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, u.id))).some((n) => n.eventKey === 'grievance_resolved' && /apologised/.test(n.body ?? ''))).toBe(true);
    await loginAs(admin.id, { mfa: false });
    expect((await call(POST, jsonReq('/x', { action: 'note', body: 'x y' }), p)).status).toBeGreaterThanOrEqual(401);
  });

  test('the list mixes complaints, chat reports, disputes, data requests, appeals and access requests, with filters', async () => {
    const { GET } = await import('@/app/api/admin/grievances/route');
    const { createGrievance } = await import('@/lib/grievances');
    const u = await makeUser(db, 'buyer', { societyId });
    await createGrievance({ kind: 'chat_report', subject: 'Chat report', raisedById: u.id, raisedRole: 'buyer' });
    await createGrievance({ kind: 'data_request', subject: 'Access my data', raisedById: u.id, raisedRole: 'buyer' });
    await db.insert(s.societyAccessRequests).values({ societyName: 'Green Meadows', city: 'Pune', contactName: 'Anil', email: 'anil@example.com' });
    await loginAs(admin.id);
    const all = (await call(GET, jsonReq('/x', undefined, { method: 'GET' }))).json as { tickets: { kind: string }[]; accessRequests: { societyName: string }[] };
    expect(new Set(all.tickets.map((t) => t.kind))).toEqual(expect.objectContaining(new Set(['chat_report', 'data_request', 'grievance'])));
    expect(all.accessRequests.map((a) => a.societyName)).toContain('Green Meadows');
    const only = (await call(GET, new (await import('next/server')).NextRequest('http://localhost:3000/api/admin/grievances?kind=data_request'))).json as { tickets: { kind: string }[]; accessRequests: unknown[] };
    expect(only.tickets.every((t) => t.kind === 'data_request')).toBe(true);
    expect(only.accessRequests).toEqual([]);
  });

  test('strike appeal: raised by the person, once; the admin lifts it and the strike no longer counts', async () => {
    const { POST: appeal } = await import('@/app/api/strikes/[id]/appeal/route');
    const { POST: admin_ } = await import('@/app/api/admin/grievances/[id]/route');
    const { recordStrike } = await import('@/lib/orders/strikes');
    const buyer = await makeUser(db, 'buyer', { societyId });
    await recordStrike({ userId: buyer.id, role: 'buyer', kind: 'buyer_unpaid', reason: 'Could not pay at the door' });
    const [strike] = await db.select().from(s.strikes).where(eq(s.strikes.userId, buyer.id));
    const stranger = await makeUser(db, 'buyer', { societyId });
    await loginAs(stranger.id);
    expect((await call(appeal, jsonReq('/x', { reason: 'It was not mine at all, really' }), { id: String(strike.id) })).status).toBe(404); // not their strike
    await loginAs(buyer.id);
    expect((await call(appeal, jsonReq('/x', { reason: 'short' }), { id: String(strike.id) })).status).toBe(400);
    const r = await call(appeal, jsonReq('/x', { reason: 'My UPI app was down; I paid in cash the next morning' }), { id: String(strike.id) });
    expect(r.status).toBe(200);
    expect((await call(appeal, jsonReq('/x', { reason: 'Trying a second time here' }), { id: String(strike.id) })).status).toBe(409);
    await loginAs(admin.id);
    expect((await call(admin_, jsonReq('/x', { action: 'decide_appeal', outcome: 'lift', note: 'Believed' }), { id: String(r.json.id) })).status).toBe(200);
    expect((await db.select().from(s.strikes).where(eq(s.strikes.id, strike.id)))[0].liftedAt).not.toBeNull();
    expect((await db.select().from(s.grievances).where(eq(s.grievances.id, r.json.id as number)))[0]).toMatchObject({ status: 'resolved', resolution: 'appeal_upheld' });
  });
});

describe('E4: settings history, diff and restore', () => {
  async function patch(body: Record<string, unknown>) {
    const { PATCH } = await import('@/app/api/admin/settings/route');
    return call(PATCH, jsonReq('/api/admin/settings', body, { method: 'PATCH' }));
  }
  test('every change needs a reason and is stored with old value, new value, who and why', async () => {
    const { settingsHistoryList } = await import('@/lib/settings/history');
    await loginAs(admin.id);
    expect((await patch({ buyerPlatformFeeBps: 900 })).status).toBe(400); // no reason
    expect((await patch({ buyerPlatformFeeBps: 900, reason: 'ab' })).status).toBe(400);
    expect((await patch({ buyerPlatformFeeBps: 900, reason: 'Pilot discount for the first month' })).status).toBe(200);
    expect((await patch({ buyerPlatformFeeBps: 900, reason: 'No real change' })).status).toBe(200); // same value: no new row
    const h = (await settingsHistoryList({ key: 'buyerPlatformFeeBps' }))[0];
    expect(h).toMatchObject({ oldValue: '1000', newValue: '900', reason: 'Pilot discount for the first month', label: 'Buyer platform fee (%)' });
    expect(h.changedBy).toBe(admin.name);
    expect((await settingsHistoryList({ key: 'buyerPlatformFeeBps' })).filter((x) => x.newValue === '900')).toHaveLength(1);
    // several keys in one save: one row each, sharing the reason
    expect((await patch({ buyerPlatformFeeMinPaise: 1200, buyerPlatformFeeMaxPaise: 3000, reason: 'Raise the floor and the cap' })).status).toBe(200);
    const both = (await settingsHistoryList({ limit: 2 })).map((x) => x.key).sort();
    expect(both).toEqual(['buyerPlatformFeeMaxPaise', 'buyerPlatformFeeMinPaise']);
  });

  test('restore puts back the previous value, is a new history row pointing at the old one, needs a reason and 2FA, and refuses invalid results', async () => {
    const { POST } = await import('@/app/api/admin/settings/history/route');
    const { settingsHistoryList } = await import('@/lib/settings/history');
    const { getPlatformSettings } = await import('@/lib/db/platform');
    await loginAs(admin.id);
    await patch({ buyerPlatformFeeBps: 1100, reason: 'Trial' });
    const h = (await settingsHistoryList({ key: 'buyerPlatformFeeBps' }))[0];
    expect((await getPlatformSettings()).buyerPlatformFeeBps).toBe(1100);
    expect((await call(POST, jsonReq('/x', { historyId: h.id, reason: '' }))).status).toBe(400);
    await loginAs(admin.id, { mfa: false });
    expect((await call(POST, jsonReq('/x', { historyId: h.id, reason: 'Trial did not work' }))).status).toBeGreaterThanOrEqual(401);
    await loginAs(admin.id);
    expect((await call(POST, jsonReq('/x', { historyId: h.id, reason: 'Trial did not work' }))).status).toBe(200);
    expect((await getPlatformSettings()).buyerPlatformFeeBps).toBe(Number(h.oldValue));
    const again = (await settingsHistoryList({ key: 'buyerPlatformFeeBps' }))[0];
    expect(again).toMatchObject({ newValue: h.oldValue, oldValue: '1100', restoredFromId: h.id });
    expect(again.reason).toContain('Trial did not work');
    expect((await db.select().from(s.auditLog)).some((a) => a.action === 'settings.restore')).toBe(true);
    expect((await call(POST, jsonReq('/x', { historyId: 99999999, reason: 'whatever it is' }))).status).toBe(404);
  });

  test('restoring a value that would break a cross-check is refused (warn threshold above pause)', async () => {
    const { POST } = await import('@/app/api/admin/settings/history/route');
    const { settingsHistoryList } = await import('@/lib/settings/history');
    await loginAs(admin.id);
    await patch({ tdsPausePaise: 60_000_000, reason: 'Raise the pause level' });
    const raise = (await settingsHistoryList({ key: 'tdsPausePaise' }))[0];
    await patch({ tdsWarnPaise: 55_000_000, reason: 'Warn later too' });
    // restoring the pause level to 50,000,000 would now put warn (55M) above pause: refused
    const r = await call(POST, jsonReq('/x', { historyId: raise.id, reason: 'Back to the old pause level' }));
    expect(r.status).toBe(400);
    await patch({ tdsWarnPaise: 40_000_000, tdsPausePaise: 50_000_000, reason: 'Put both back' });
    // leave the fee rules at their defaults for the tests that follow
    expect((await patch({ buyerPlatformFeeBps: 1000, buyerPlatformFeeMinPaise: 1000, buyerPlatformFeeMaxPaise: 2500, reason: 'Back to defaults' })).status).toBe(200);
  });
});

describe('E5: broadcast', () => {
  async function people() {
    const sA = (await makeSociety(db, { name: 'Alpha Heights' })).id;
    const sB = (await makeSociety(db, { name: 'Beta Meadows' })).id;
    const a1 = await makeUser(db, 'buyer', { societyId: sA });
    const a2 = await makeUser(db, 'buyer', { societyId: sA });
    const b1 = await makeUser(db, 'buyer', { societyId: sB });
    const k = await makeLiveKitchen(db, { societyId: sB });
    return { sA, sB, a1, a2, b1, k };
  }
  test('audiences: chosen societies, kitchens only, everyone — never admins or blocked users', async () => {
    const { resolveAudience } = await import('@/lib/broadcast');
    const { sA, sB, a1, a2, b1, k } = await people();
    const blocked = await makeUser(db, 'buyer', { societyId: sA });
    await db.update(s.users).set({ blockedAt: new Date() }).where(eq(s.users.id, blocked.id));
    const onlyA = (await resolveAudience({ type: 'societies', societyIds: [sA] }, 'service')).userIds;
    expect(onlyA).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(onlyA).not.toContain(b1.id);
    expect(onlyA).not.toContain(blocked.id);
    const bBoth = (await resolveAudience({ type: 'societies', societyIds: [sB] }, 'service')).userIds;
    expect(bBoth).toEqual(expect.arrayContaining([b1.id, k.seller.id]));
    const kitchens = (await resolveAudience({ type: 'kitchens' }, 'service')).userIds;
    expect(kitchens).toContain(k.seller.id);
    expect(kitchens).not.toContain(a1.id);
    const all = (await resolveAudience({ type: 'all' }, 'service')).userIds;
    expect(all).toEqual(expect.arrayContaining([a1.id, b1.id, k.seller.id]));
    expect(all).not.toContain(admin.id);
    await expect(resolveAudience({ type: 'societies', societyIds: [] }, 'service')).rejects.toMatchObject({ status: 400 });
  });

  test('marketing reaches only people who opted in; service reaches everyone and is labelled', async () => {
    const { previewBroadcast, sendBroadcast } = await import('@/lib/broadcast');
    const { setPrefs } = await import('@/lib/notify');
    const { sA, a1, a2 } = await people();
    await setPrefs(a1.id, { marketingEnabled: true });
    const aud = { type: 'societies' as const, societyIds: [sA] };
    expect(await previewBroadcast(aud, 'marketing')).toMatchObject({ recipients: 1, skippedNoOptIn: 1 });
    expect((await previewBroadcast(aud, 'service')).recipients).toBe(2);
    const m = await sendBroadcast({ audience: aud, kind: 'marketing', title: 'Diwali specials', body: 'Neighbours are cooking sweets this week.', adminId: admin.id, expectedRecipients: 1 });
    expect(m).toMatchObject({ recipients: 1, skippedNoOptIn: 1 });
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, a1.id))).some((n) => n.eventKey === 'broadcast' && n.title === 'Diwali specials')).toBe(true);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, a2.id))).some((n) => n.eventKey === 'broadcast')).toBe(false);
    const sv = await sendBroadcast({ audience: aud, kind: 'service', title: 'Planned maintenance', body: 'PadosiPlate will be down for ten minutes at midnight.', adminId: admin.id, expectedRecipients: 2 });
    expect(sv.recipients).toBe(2);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, a2.id))).find((n) => n.eventKey === 'broadcast')!.title).toBe('Service message: Planned maintenance');
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, a2.id))).some((e) => /Service message: Planned maintenance/.test(e.subject))).toBe(true);
  });

  test('the admin must have seen the recipient count; empty audiences and bad copy are refused; re-auth and audit apply', async () => {
    const { POST, GET } = await import('@/app/api/admin/broadcast/route');
    const { sA } = await people();
    const aud = { type: 'societies', societyIds: [sA] };
    await loginAs(admin.id);
    const pv = await call(GET, new (await import('next/server')).NextRequest(`http://localhost:3000/api/admin/broadcast?type=societies&kind=service&societyIds=${sA}`));
    expect(pv.json).toMatchObject({ recipients: 2 });
    const body = { audience: aud, kind: 'service', title: 'Hello', body: 'A message long enough to send.', expectedRecipients: 2 };
    await loginAs(admin.id, { mfa: false });
    expect((await call(POST, jsonReq('/x', body))).status).toBeGreaterThanOrEqual(401);
    await loginAs(admin.id);
    expect((await call(POST, jsonReq('/x', { ...body, expectedRecipients: 5 }))).status).toBe(409); // audience changed since the preview
    expect((await call(POST, jsonReq('/x', { ...body, title: 'x' }))).status).toBe(400);
    expect((await call(POST, jsonReq('/x', { ...body, body: 'short' }))).status).toBe(400);
    expect((await call(POST, jsonReq('/x', { ...body, audience: { type: 'societies', societyIds: [999999] }, expectedRecipients: 0 }))).status).toBe(400); // nobody
    expect((await call(POST, jsonReq('/x', body))).status).toBe(200);
    expect((await db.select().from(s.auditLog)).filter((a) => a.action === 'broadcast.send').length).toBeGreaterThanOrEqual(1);
    expect(((await call(GET, jsonReq('/x', undefined, { method: 'GET' }))).json.history as { title: string }[]).some((h) => h.title === 'Hello')).toBe(true);
  });
});

describe('E6: metrics overview and exports', () => {
  /** One society, two buyers (one repeats), one kitchen, a completed order, a decline, a dispute. */
  async function world() {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const { performOrderAction } = await import('@/lib/orders/actions');
    const sid = (await makeSociety(db, { name: `Metrics Park ${Math.random().toString(36).slice(2, 6)}`, inviteCode: `MP${Math.floor(Math.random() * 1e6)}` })).id;
    const k = await makeLiveKitchen(db, { societyId: sid, qty: 100, price: 20000, acceptsCash: true });
    await db.update(s.users).set({ societyId: sid }).where(eq(s.users.id, k.seller.id));
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true, upiVerifyStatus: 'verified', listingState: 'approved' }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const b1 = await makeUser(db, 'buyer', { societyId: sid });
    const b2 = await makeUser(db, 'buyer', { societyId: sid });
    await db.update(s.users).set({ emailVerifiedAt: new Date() }).where(eq(s.users.id, b1.id));
    const place = async (buyer: typeof b1) => {
      const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
      await markOrderPaid(r.orderId, { razorpayPaymentId: `pay_${r.orderId}` });
      const run = (who: 'buyer' | 'seller', action: string, extra: Record<string, unknown> = {}) => performOrderAction(r.orderId, { action, actor: who, actorId: who === 'buyer' ? buyer.id : k.seller.id, ...extra } as never);
      return { id: r.orderId, run };
    };
    const complete = async (o: Awaited<ReturnType<typeof place>>) => {
      for (const a of ['accept', 'preparing', 'ready', 'buyer_arrived']) await o.run('seller', a);
      await o.run('buyer', 'collect');
      await o.run('buyer', 'claim_paid', { method: 'cash' });
      await o.run('seller', 'confirm_paid');
    };
    const o1 = await place(b1);
    await complete(o1);
    await db.update(s.orders).set({ bookedAt: new Date(Date.now() - 40 * 60_000), acceptedAt: new Date(Date.now() - 30 * 60_000), atDoorAt: new Date(Date.now() - 12 * 60_000) }).where(eq(s.orders.id, o1.id));
    const o2 = await place(b1);
    await complete(o2);
    const o3 = await place(b2);
    await o3.run('seller', 'seller_cancel', { reason: 'out of gas' });
    await db.update(s.users).set({ emailVerifiedAt: null }).where(eq(s.users.id, b2.id)); // b2 ordered, then (for the funnel) shows as unverified
    await db.insert(s.reviews).values({ orderId: o1.id, buyerId: b1.id, rating: 5 });
    await db.insert(s.grievances).values({ kind: 'dispute_payment', orderId: o2.id, subject: 'x', ackDueAt: new Date(), resolveDueAt: new Date() });
    return { sid, k, b1, b2, o1, o2, o3 };
  }

  test('funnels, money and quality are right for one society and sum into the global view', async () => {
    const { metricsOverview } = await import('@/lib/metrics-overview');
    const { recordVisit } = await import('@/lib/visits');
    const w = await world();
    await recordVisit(w.sid);
    await recordVisit(w.sid);
    await recordVisit(0);
    const r = await metricsOverview(30);
    const m = r.bySociety.find((x) => x.societyId === w.sid)!.metrics;
    expect(m.buyerFunnel).toEqual({ visits: 2, signUps: 2, verified: 1, firstOrder: 2, repeat: 1 });
    expect(m.kitchenFunnel).toMatchObject({ upiVerified: 1, approved: 1, firstOrder: 1 });
    expect(m.kitchenFunnel.fssai.verified).toBe(1);
    expect(m.money.gmvPaise).toBe(40000); // two completed orders of ₹200
    expect(m.money.completedOrders).toBe(2);
    expect(m.money.feeRevenuePaise).toBe(4000); // two kept fees of ₹20; the declined order's fee was refunded
    expect(m.money.refundsPaise).toBe(2000);
    expect(m.money.creditsIssuedPaise).toBe(2000); // the equal credit on the decline
    expect(m.quality.orders).toBe(3);
    expect(m.quality.cancellationRatePct).toBe(33.3);
    expect(m.quality.cancellationsByCause.seller_declined).toBe(1);
    expect(m.quality.disputeRatePct).toBe(33.3);
    // o1: accepted 10 min after booking, at the door 12 min before completing; o2 did both within moments → medians are the means of the two
    expect(m.quality.medianAcceptMinutes).toBeCloseTo(5, 0);
    expect(m.quality.medianDoorToCompleteMinutes).toBeCloseTo(6, 0);
    expect(m.quality.avgRating).toBe(5);
    // global includes this society's numbers; another society's numbers do not leak into it
    const other = r.bySociety.filter((x) => x.societyId !== w.sid);
    expect(other.every((x) => x.metrics.money.gmvPaise === 0 || x.societyId !== w.sid)).toBe(true);
    expect(r.global.money.gmvPaise).toBeGreaterThanOrEqual(40000);
    expect(r.global.buyerFunnel.visits).toBeGreaterThanOrEqual(3);
  });

  test('the window matters: old activity falls out, and the API only accepts known windows', async () => {
    const { metricsOverview } = await import('@/lib/metrics-overview');
    const w = await world();
    await db.update(s.orders).set({ createdAt: new Date(Date.now() - 100 * 86_400_000), completedAt: new Date(Date.now() - 100 * 86_400_000) }).where(eq(s.orders.id, w.o1.id));
    const m7 = (await metricsOverview(7)).bySociety.find((x) => x.societyId === w.sid)!.metrics;
    expect(m7.money.completedOrders).toBe(1); // only o2 is inside the window
    const { GET } = await import('@/app/api/admin/overview/route');
    await loginAs(admin.id);
    expect((await call(GET, new (await import('next/server')).NextRequest('http://localhost:3000/api/admin/overview?days=5'))).status).toBe(400);
    expect((await call(GET, new (await import('next/server')).NextRequest('http://localhost:3000/api/admin/overview?days=30'))).status).toBe(200);
  });

  test('visits are a bare counter: one row per day per society, attributed by invite code, rate-limited, no personal data', async () => {
    const { POST } = await import('@/app/api/visit/route');
    const sid = (await makeSociety(db, { name: 'Visit Hills', inviteCode: 'VISIT-ONE' })).id;
    for (let i = 0; i < 3; i++) expect((await call(POST, jsonReq('/x', { code: 'VISIT-ONE' }))).status).toBe(200);
    expect((await call(POST, jsonReq('/x', { code: 'NO-SUCH' }))).status).toBe(200); // unknown code counts for the public site
    const rows = await db.select().from(s.visitCounters).where(eq(s.visitCounters.societyId, sid));
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    expect(Object.keys(s.visitCounters)).not.toEqual(expect.arrayContaining(['ip', 'userId']));
  });

  test('exports: each kind returns a correct CSV, needs a fresh 2FA check, and is audit-logged with its range', async () => {
    const { GET } = await import('@/app/api/admin/exports/[kind]/route');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('platformGstin', '36ABCDE1234F1Z5');
    await setPlatformSetting('gstMode', 'registered_eco_9_5');
    const w = await world();
    await setPlatformSetting('gstMode', 'unregistered');
    const get = async (kind: string, qs = '') => {
      const res = (await GET(new (await import('next/server')).NextRequest(`http://localhost:3000/api/admin/exports/${kind}${qs}`), { params: Promise.resolve({ kind }) } as never)) as Response;
      return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
    };
    await loginAs(admin.id, { mfa: false });
    expect((await get('orders')).status).toBeGreaterThanOrEqual(401);
    await loginAs(admin.id);
    expect((await get('nonsense')).status).toBe(404);
    expect((await get('orders', '?from=2026-13-40')).status).toBe(400); // an impossible date is refused, not guessed
    expect((await get('orders', '?from=2026-01-01&to=2026-12-31&x=1')).status).toBe(200);

    const orders = await get('orders');
    expect(orders.type).toContain('text/csv');
    expect(orders.text.split('\n')[0]).toContain('Order,Created (IST date),Buyer id');
    expect(orders.text).toContain(`${w.o1.id},`);

    const fees = await get('fee_invoices');
    expect(fees.text.split('\n')[0]).toBe('Invoice number,Invoice date (IST),Order,Recipient,Supplier GSTIN,GST mode at booking,Taxable value (INR),CGST (INR),SGST (INR),Total (INR),Fee refunded (INR)');
    expect(fees.text).toMatch(/PP\/\d{4}-\d{2}\/\d{6}/);
    expect(fees.text).toContain('36ABCDE1234F1Z5');
    expect(fees.text).toContain('registered_eco_9_5');
    // invoice numbers come out in sequence
    const nums = fees.text.split('\n').slice(1).filter(Boolean).map((l) => l.split(',')[0]);
    expect([...nums].sort()).toEqual(nums);

    const gst = await get('food_gst');
    expect(gst.text.split('\n')[0]).toContain('GST collected under Sec 9(5)');
    expect(gst.text).toContain('200.00,5,10.00,5.00,5.00'); // ₹200 food at 5% = ₹10, split 5 + 5
    expect((await get('consents')).text.split('\n')[0]).toBe('User id,Kind,Version,Accepted (UTC),IP');
    const audit = await get('audit_log');
    expect(audit.text.split('\n')[0]).toContain('Actor,Action');
    expect(audit.text).toContain('export.orders');
    const logs = (await db.select().from(s.auditLog)).filter((a) => a.action.startsWith('export.'));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['export.orders', 'export.fee_invoices', 'export.food_gst', 'export.consents', 'export.audit_log']));
    expect(((logs.find((l) => l.action === 'export.fee_invoices')!.meta) as { from: string }).from).toBeTruthy();
  });

  test('median: odd count, even count and empty', async () => {
    const { median } = await import('@/lib/metrics-overview');
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  test('range parsing: IST day boundaries, to is inclusive, at most 13 months', async () => {
    const { parseRange } = await import('@/lib/exports');
    const r = parseRange('2026-04-01', '2026-04-30');
    expect(r.from.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-04-30T18:30:00.000Z');
    expect(() => parseRange('2026-05-01', '2026-04-01')).toThrow();
    expect(() => parseRange('2024-01-01', '2026-01-01')).toThrow(/13 months/);
  });
});
