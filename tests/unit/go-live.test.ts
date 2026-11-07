import { beforeAll, afterEach, describe, expect, test, vi } from 'vitest';
import { buildGoLiveRows, liveBlockers } from '@/lib/go-live';
import { SETTING_DEFS } from '@/lib/settings/defs';
import { useTestDb } from '../helpers/db';

vi.mock('next/headers', () => import('../helpers/next-headers'));

const settings = (over: Record<string, unknown> = {}) =>
  ({ ...(Object.fromEntries(Object.entries(SETTING_DEFS).map(([k, d]) => [k, (d as { def: unknown }).def])) as Record<string, unknown>), ...over }) as never;
const facts = { storageReachable: true, cronFresh: true, legalAllReviewed: true, legalCount: 10 };
const fullEnv = { RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' };
const fullSettings = { platformFssaiCentralLicenseNo: '12345678901234', gstPositionConfirmedAt: '2026-11-10', grievanceOfficer: 'A, Officer', legalEntityName: 'PadosiPlate Pvt Ltd', registeredAddress: 'Hyderabad', supportEmail: 'help@x.in', supportPhone: '9999999999', upiVerifyProvider: 'razorpay_checkout_vpa' };

describe('go-live checklist', () => {
  test('everything missing: all blocking rows are red; vapid and legal review only warn', () => {
    const rows = buildGoLiveRows(settings({ upiVerifyProvider: 'mock' }), {}, { storageReachable: false, cronFresh: false, legalAllReviewed: false, legalCount: 10 });
    const blockers = liveBlockers(rows).map((r) => r.key);
    expect(blockers).toEqual(expect.arrayContaining(['platformFssaiCentralLicenseNo', 'gstPosition', 'legalEntity', 'grievanceOfficer', 'support', 'razorpayKeys', 'razorpayWebhook', 'upiProvider']));
    // operational checks are red on the page but never blockers
    expect(rows.find((r) => r.key === 'storage')).toMatchObject({ status: 'missing', kind: 'ops', blocking: false });
    expect(rows.find((r) => r.key === 'cron')).toMatchObject({ status: 'missing', kind: 'ops', blocking: false });
    expect(blockers).not.toContain('storage');
    expect(blockers).not.toContain('cron');
    expect(rows.find((r) => r.key === 'vapid')).toMatchObject({ status: 'warn', kind: 'ops', blocking: false });
    expect(rows.find((r) => r.key === 'legalReviewed')).toMatchObject({ status: 'warn', blocking: false });
    expect(blockers).not.toContain('vapid');
  });
  test('all set: no blockers', () => {
    const rows = buildGoLiveRows(settings(fullSettings), fullEnv, facts);
    expect(liveBlockers(rows)).toEqual([]);
    expect(rows.every((r) => r.status === 'ok')).toBe(true);
  });
  test.each([
    ['platformFssaiCentralLicenseNo', { platformFssaiCentralLicenseNo: '' }, {}],
    ['upiProvider', { upiVerifyProvider: 'mock' }, {}],
    ['razorpayKeys', {}, { RAZORPAY_KEY_SECRET: '' }],
    ['razorpayWebhook', {}, { RAZORPAY_WEBHOOK_SECRET: undefined }],
  ])('a single gap (%s) blocks live mode', (key, sOver, eOver) => {
    const rows = buildGoLiveRows(settings({ ...fullSettings, ...sOver }), { ...fullEnv, ...eOver }, facts);
    expect(liveBlockers(rows).map((r) => r.key)).toEqual([key]);
  });
  test('warnings alone never block', () => {
    const rows = buildGoLiveRows(settings(fullSettings), { ...fullEnv, VAPID_PUBLIC_KEY: '' }, { ...facts, legalAllReviewed: false });
    expect(liveBlockers(rows)).toEqual([]);
  });
});

describe('the live guard shares the same list', () => {
  let prev: string | undefined;
  beforeAll(async () => {
    await useTestDb();
    prev = process.env.MOCK_MODE;
  });
  afterEach(() => {
    process.env.MOCK_MODE = prev;
  });
  test('refuses with 503 naming what is missing, and passes in mock mode', async () => {
    const { assertLiveModeReady } = await import('@/lib/live-guard');
    process.env.MOCK_MODE = 'true';
    await expect(assertLiveModeReady()).resolves.toBeUndefined();
    process.env.MOCK_MODE = 'false';
    await expect(assertLiveModeReady()).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Central licence') });
    await expect(assertLiveModeReady()).rejects.toMatchObject({ message: expect.stringContaining('Go-live') });
  });
});
