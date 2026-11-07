import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { buildGoLiveRows, configBlockers } from '@/lib/go-live';
import { opsTransition } from '@/lib/ops-alerts';

vi.mock('next/headers', () => import('../helpers/next-headers'));
// Live mode must not call the real gateway: stub the adapter.
vi.mock('@/lib/payments/razorpay', async (orig) => ({
  ...(await orig<typeof import('@/lib/payments/razorpay')>()),
  createRazorpayOrder: async () => ({ id: `order_stub_${Math.random().toString(36).slice(2, 8)}`, keyId: 'rzp_live_x' }),
}));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
const prevEnv = { ...process.env };
beforeAll(async () => {
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});
afterAll(() => {
  process.env = prevEnv;
});

const CONFIG = { platformFssaiCentralLicenseNo: '12345678901234', gstPositionConfirmedAt: '2026-11-10', gstPositionNote: 'ok', grievanceOfficer: 'A, Officer', legalEntityName: 'PadosiPlate Pvt Ltd', registeredAddress: 'Hyderabad', supportEmail: 'help@x.in', supportPhone: '9999999999', upiVerifyProvider: 'razorpay_checkout_vpa' };
async function goLive(over: Record<string, string> = {}) {
  const { setPlatformSetting } = await import('@/lib/db/platform');
  for (const [k, v] of Object.entries({ ...CONFIG, ...over })) await setPlatformSetting(k, v);
  Object.assign(process.env, { MOCK_MODE: 'false', RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 'rzp_secret_value', RAZORPAY_WEBHOOK_SECRET: 'whsec' });
}

describe('F1: live mode — ordering only depends on configuration', () => {
  test('a stale cron heartbeat and an unreachable storage do not stop an order', async () => {
    await goLive();
    // stale heartbeat (three hours old) and a storage adapter that throws on ping
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('cronLastRunAt', new Date(Date.now() - 3 * 3_600_000).toISOString());
    const storage = await import('@/lib/storage');
    const ping = vi.spyOn(await storage.getStorage(), 'ping').mockRejectedValue(new Error('storage down'));
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    expect(r.orderId).toBeGreaterThan(0);
    expect(ping).not.toHaveBeenCalled(); // the guard did no storage I/O at all
    ping.mockRestore();
  });

  test.each([
    ['the platform FSSAI Central licence', { platformFssaiCentralLicenseNo: '' }, {}],
    ['the grievance officer', { grievanceOfficer: '' }, {}],
    ['Razorpay keys', {}, { RAZORPAY_KEY_SECRET: '' }],
    ['the webhook secret', {}, { RAZORPAY_WEBHOOK_SECRET: '' }],
    ['the UPI provider', { upiVerifyProvider: 'mock' }, {}],
  ])('a missing configuration prerequisite (%s) refuses the order with 503', async (_label, sOver, eOver) => {
    await goLive(sOver as Record<string, string>);
    Object.assign(process.env, eOver);
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId });
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 503 });
  });

  test('the page list and the guard share one source: the guard blocks on exactly the config rows of buildGoLiveRows', async () => {
    const { getPlatformSettings } = await import('@/lib/db/platform');
    await goLive({ platformFssaiCentralLicenseNo: '' });
    const settings = await getPlatformSettings();
    const env = { ...process.env, RAZORPAY_KEY_ID: '' };
    const rows = buildGoLiveRows(settings, env, { storageReachable: false, cronFresh: false, legalAllReviewed: false, legalCount: 0 });
    const fromPage = rows.filter((r) => r.blocking && r.status !== 'ok').map((r) => r.key).sort();
    expect(configBlockers(settings, env).map((r) => r.key).sort()).toEqual(fromPage);
    expect(rows.filter((r) => r.kind === 'config').every((r) => r.blocking)).toBe(true);
    expect(rows.filter((r) => r.kind === 'ops').every((r) => !r.blocking)).toBe(true);
  });
});

describe('F1: operational alerts', () => {
  test('pure transitions: one alert per incident, cooldown on flapping, a recovery only after an alert', () => {
    const t0 = new Date('2026-11-10T10:00:00Z');
    const empty = { open: false, alerted: false, alertedAt: null };
    const a = opsTransition(empty, true, t0);
    expect(a.send).toBe('alert');
    expect(opsTransition(a.next, true, new Date(t0.getTime() + 600_000)).send).toBeNull(); // still bad: nothing more
    const rec = opsTransition(a.next, false, new Date(t0.getTime() + 1_200_000));
    expect(rec.send).toBe('recovered');
    // flaps bad again 30 minutes after the first alert: inside the 2-hour cooldown, so no new alert and no recovery notice
    const flap = opsTransition(rec.next, true, new Date(t0.getTime() + 1_800_000));
    expect(flap.send).toBeNull();
    expect(opsTransition(flap.next, false, new Date(t0.getTime() + 2_400_000)).send).toBeNull();
    // a fresh incident after the cooldown alerts again
    expect(opsTransition(rec.next, true, new Date(t0.getTime() + 3 * 3_600_000)).send).toBe('alert');
  });

  test('both admins get one in-app notice per incident and one recovery notice; mock mode alerts nobody', async () => {
    const { checkOpsHealth } = await import('@/lib/ops-alerts');
    const a1 = await makeUser(db, 'admin', { societyId });
    const a2 = await makeUser(db, 'admin', { societyId });
    process.env.ADMIN_EMAILS = `${a1.email},${a2.email}`;
    const count = async (key: string) => (await db.select().from(s.notifications)).filter((n) => n.eventKey === key && [a1.id, a2.id].includes(n.userId)).length;

    process.env.MOCK_MODE = 'true';
    await checkOpsHealth(new Date('2026-11-12T10:00:00Z'), { storageOk: false, cronStale: true });
    expect(await count('ops_alert')).toBe(0);

    process.env.MOCK_MODE = 'false';
    const t = new Date('2026-11-12T10:05:00Z');
    const bad = { storageOk: false, cronStale: true, cronAgeMinutes: 180 };
    expect((await checkOpsHealth(t, bad)).alerts.sort()).toEqual(['cron', 'storage']);
    expect(await count('ops_alert')).toBe(4); // 2 checks × 2 admins
    await checkOpsHealth(new Date(t.getTime() + 300_000), bad); // still down: no repeat
    expect(await count('ops_alert')).toBe(4);
    const good = { storageOk: true, cronStale: false, cronAgeMinutes: 1 };
    expect((await checkOpsHealth(new Date(t.getTime() + 600_000), good)).recovered.sort()).toEqual(['cron', 'storage']);
    expect(await count('ops_recovered')).toBe(4);
    await checkOpsHealth(new Date(t.getTime() + 900_000), good); // healthy: nothing more
    expect(await count('ops_recovered')).toBe(4);
    // the email copy went to the outbox for both admins
    const mails = await db.select().from(s.emailOutbox);
    expect(mails.filter((m) => /needs attention/i.test(m.subject) && [a1.email, a2.email].includes(m.toEmail ?? '')).length).toBeGreaterThanOrEqual(2);
  });
});
