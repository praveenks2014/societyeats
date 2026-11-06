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
const DAY = 86_400_000;

beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
  admin = await makeUser(db, 'admin');
  process.env.ADMIN_EMAILS = admin.email!;
});

async function appliedKitchen(filedDaysAgo: number, over: Partial<typeof s.fssaiApplications.$inferInsert> = {}) {
  const k = await makeLiveKitchen(db, { societyId, fssai: 'provisional' });
  await db.update(s.sellerProfiles).set({ fssaiStatus: 'pending_application', provisionalStartedAt: null }).where(eq(s.sellerProfiles.userId, k.seller.id));
  const [app] = await db.insert(s.fssaiApplications).values({ sellerId: k.seller.id, applicantName: 'A', kitchenAddress: 'x', status: 'filed_on_foscos', foscosRefNumber: `REF${k.seller.id}`, filedAt: new Date(Date.now() - filedDaysAgo * DAY), filingMode: 'self', ...over }).returning();
  return { ...k, app };
}

async function patch(appId: number, body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/admin/fssai/[id]/route');
  return call(PATCH, jsonReq('/x', body, { method: 'PATCH' }), { id: String(appId) });
}

describe('A1: FSSAI admin queue', () => {
  test('queue rows carry tier, days, deemed-window status, interruption and the advisory lookup', async () => {
    const inside = await appliedKitchen(3);
    const passed = await appliedKitchen(10);
    await db.update(s.sellerProfiles).set({ fssaiNumber: '12345678901234' }).where(eq(s.sellerProfiles.userId, passed.seller.id));
    const { GET } = await import('@/app/api/admin/fssai/route');
    await loginAs(admin.id);
    const r = await call(GET, jsonReq('/x', undefined, { method: 'GET' }));
    const rows = r.json.applications as { id: number; tier: string; deemedWindow: string; daysSinceFiled: number; lookup: { found: boolean; status: string }; fssaiNumber: string | null }[];
    const a = rows.find((x) => x.id === inside.app.id)!;
    const b = rows.find((x) => x.id === passed.app.id)!;
    expect(a).toMatchObject({ tier: 'applied', deemedWindow: 'inside', daysSinceFiled: 3 });
    expect(b).toMatchObject({ tier: 'provisional', deemedWindow: 'passed', daysSinceFiled: 10 });
    expect(b.lookup).toMatchObject({ found: true, status: 'active' }); // mock: numbers starting 1 are active
    expect(a.lookup.found).toBe(false);
  });

  test('recording an interruption needs a valid past date, ends buyer visibility, notifies, and is audited', async () => {
    const k = await appliedKitchen(10);
    await loginAs(admin.id);
    expect((await patch(k.app.id, { action: 'inspection_ordered', date: 'tomorrow' })).status).toBe(400);
    const future = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10); // clearly after today in IST too
    expect((await patch(k.app.id, { action: 'inspection_ordered', date: future })).status).toBe(400);
    const { istDateString } = await import('@/lib/time');
    const date = istDateString(new Date(Date.now() - 2 * DAY));
    const r = await patch(k.app.id, { action: 'inspection_ordered', date, note: 'visit on Monday' });
    expect(r.status).toBe(200);
    const [app] = await db.select().from(s.fssaiApplications).where(eq(s.fssaiApplications.id, k.app.id));
    expect(app.status).toBe('inspection_ordered');
    expect(istDateString(app.interruptionAt!)).toBe(date);
    const { kitchenGate } = await import('@/lib/kitchen/gate');
    expect((await kitchenGate(k.seller.id)).checks.fssai).toBe(false);
    expect((await db.select().from(s.auditLog)).some((a) => a.action === 'fssai.interruption' && a.targetId === String(k.app.id))).toBe(true);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, k.seller.id))).some((n) => /inspection/i.test(n.title))).toBe(true);
    // a second interruption on the same application is refused (it is no longer filed)
    expect((await patch(k.app.id, { action: 'inadequacy_notice', date })).status).toBe(400);
  });

  test('block hides a verified kitchen, unblock restores it; both need a reason / are audited', async () => {
    const k = await makeLiveKitchen(db, { societyId, fssai: 'verified' });
    const [app] = await db.insert(s.fssaiApplications).values({ sellerId: k.seller.id, applicantName: 'A', kitchenAddress: 'x', status: 'granted' }).returning();
    const { kitchenGate } = await import('@/lib/kitchen/gate');
    expect((await kitchenGate(k.seller.id)).ok).toBe(true);
    await loginAs(admin.id);
    expect((await patch(app.id, { action: 'block', reason: 'no' })).status).toBe(400);
    expect((await patch(app.id, { action: 'block', reason: 'Certificate looks altered' })).status).toBe(200);
    const g = await kitchenGate(k.seller.id);
    expect(g.ok).toBe(false);
    expect(g.checks.fssai).toBe(false);
    expect((await patch(app.id, { action: 'unblock' })).status).toBe(200);
    expect((await kitchenGate(k.seller.id)).ok).toBe(true);
    const actions = (await db.select().from(s.auditLog)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['fssai.block', 'fssai.unblock']));
  });

  test('request changes stores the note, tells the kitchen, and is audited', async () => {
    const k = await appliedKitchen(2);
    await loginAs(admin.id);
    expect((await patch(k.app.id, { action: 'request_changes', note: 'x' })).status).toBe(400);
    expect((await patch(k.app.id, { action: 'request_changes', note: 'The kitchen photo is blurred' })).status).toBe(200);
    const [app] = await db.select().from(s.fssaiApplications).where(eq(s.fssaiApplications.id, k.app.id));
    expect(app.changesRequestedNote).toBe('The kitchen photo is blurred');
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, k.seller.id))).some((n) => n.body === 'The kitchen photo is blurred')).toBe(true);
  });

  test('every decision needs a fresh 2FA check', async () => {
    const k = await appliedKitchen(2);
    await loginAs(admin.id, { mfa: false });
    expect((await patch(k.app.id, { action: 'request_changes', note: 'Please redo the photo' })).status).toBeGreaterThanOrEqual(401);
  });
});

describe('A1: Coming soon', () => {
  test('only the kitchen\'s own society sees an applied kitchen, only when the setting is on', async () => {
    const { comingSoonKitchens } = await import('@/lib/browse');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    const k = await appliedKitchen(2);
    const other = (await makeSociety(db)).id;
    await setPlatformSetting('showComingSoon', 'false');
    expect(await comingSoonKitchens(societyId)).toEqual([]);
    await setPlatformSetting('showComingSoon', 'true');
    const mine = await comingSoonKitchens(societyId);
    expect(mine.map((x) => x.sellerId)).toContain(k.seller.id);
    expect(await comingSoonKitchens(other)).toEqual([]);
    expect(await comingSoonKitchens(null)).toEqual([]);
    // once the window passes the kitchen becomes provisional (listed with a badge), so it leaves Coming soon
    await db.update(s.fssaiApplications).set({ filedAt: new Date(Date.now() - 30 * DAY) }).where(eq(s.fssaiApplications.id, k.app.id));
    expect((await comingSoonKitchens(societyId)).map((x) => x.sellerId)).not.toContain(k.seller.id);
    await setPlatformSetting('showComingSoon', 'false');
  });

  test('the listing API never returns a coming-soon kitchen\'s dishes', async () => {
    const { browseListings } = await import('@/lib/browse');
    const k = await appliedKitchen(2);
    const res = await browseListings({});
    expect(res.listings.some((l) => l.sellerId === k.seller.id)).toBe(false);
  });
});

describe('A1: badge and footer', () => {
  test('tier labels: verified shows the number, provisional says applied: provisional', async () => {
    const { sellerFssai } = await import('@/lib/fssai/seller-tier');
    const v = await makeLiveKitchen(db, { societyId, fssai: 'verified' });
    await db.update(s.sellerProfiles).set({ fssaiNumber: '21234567890123' }).where(eq(s.sellerProfiles.userId, v.seller.id));
    expect((await sellerFssai(v.seller.id)).label).toBe('FSSAI registered · 21234567890123');
    const p = await appliedKitchen(10);
    expect((await sellerFssai(p.seller.id)).label).toBe('FSSAI applied: provisional');
    const none = await makeUser(db, 'seller', { societyId });
    expect((await sellerFssai(none.id)).label).toBeNull();
  });
  test('the footer prints the platform licence only once it is set', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/site-footer.tsx', 'utf8');
    expect(src).toMatch(/licence \? <span[^>]*>/);
    expect(src).not.toMatch(/placeholder|PENDING/i);
  });
});
