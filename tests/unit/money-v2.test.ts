import { describe, expect, test } from 'vitest';
import { feeConfigFromSettings, platformFeeBase, quoteOrder, subscriptionGstBps } from '@/lib/money';
import { nameMatchScore } from '@/lib/upi-verify/name-match';
import { isValidPan, maskPan } from '@/lib/pan';
import { checkCaps, effectiveCaps, fssaiTierInfo, tierBadge } from '@/lib/fssai/tier';
import { fyLabel, fyStart } from '@/lib/orders/caps';

const base = { buyerPlatformFeeBps: 1000, buyerPlatformFeeMinPaise: 1000, buyerPlatformFeeMaxPaise: 2500, platformFeeGstBps: 1800, platformGstin: '36ABCDE1234F1Z5', gstMode: 'unregistered', ecoFoodGstBps: 500 };
const cfg = (over: Partial<typeof base> = {}) => feeConfigFromSettings({ ...base, ...over });

describe('platform fee: 10% of food, min ₹10, max ₹25', () => {
  test('clamping boundaries', () => {
    const f = cfg();
    expect(platformFeeBase(0, f)).toBe(1000);
    expect(platformFeeBase(5000, f)).toBe(1000); // 10% = ₹5 → floor ₹10
    expect(platformFeeBase(10000, f)).toBe(1000);
    expect(platformFeeBase(20000, f)).toBe(2000);
    expect(platformFeeBase(25000, f)).toBe(2500);
    expect(platformFeeBase(1_000_000, f)).toBe(2500);
  });
  test('property: for every food value the fee is an integer inside [min, max] and non-decreasing', () => {
    const f = cfg();
    let prev = 0;
    for (let food = 0; food <= 400_000; food += 137) {
      const fee = platformFeeBase(food, f);
      expect(Number.isInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThanOrEqual(1000);
      expect(fee).toBeLessThanOrEqual(2500);
      expect(fee).toBeGreaterThanOrEqual(prev);
      prev = fee;
    }
  });
  test('rates are snapshotted into the quote, so later setting changes cannot alter it', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000 }, cfg());
    expect(q.snapshot).toMatchObject({ feeBps: 1000, feeMinPaise: 1000, feeMaxPaise: 2500, feeGstBps: 0, ecoMode: 'off' });
    expect(q.onlineChargePaise).toBe(2000);
    expect(q.grandTotalPaise).toBe(22000);
  });
});

describe('GST modes', () => {
  test('unregistered: no GST anywhere, even if a GSTIN is entered', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000 }, cfg({ gstMode: 'unregistered' }));
    expect(q).toMatchObject({ feeGstPaise: 0, ecoGstPaise: 0, onlineChargePaise: 2000 });
  });
  test('registered_fee_only: 18% on the fee, nothing on the food', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000 }, cfg({ gstMode: 'registered_fee_only' }));
    expect(q).toMatchObject({ platformFeePaise: 2000, feeGstPaise: 360, ecoGstPaise: 0, onlineChargePaise: 2360 });
  });
  test('registered_eco_9_5: 18% on the fee PLUS 5% on the food, both collected at booking; the food price paid to the kitchen is unchanged', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000 }, cfg({ gstMode: 'registered_eco_9_5' }));
    expect(q).toMatchObject({ platformFeePaise: 2000, feeGstPaise: 360, ecoGstPaise: 1000, onlineChargePaise: 3360, foodTotalPaise: 20000 });
    expect(q.snapshot).toMatchObject({ ecoMode: 'collect_with_platform_fee', ecoBps: 500, feeGstBps: 1800 });
  });
  test('a registered mode without a GSTIN charges nothing (GST needs a GSTIN)', () => {
    expect(quoteOrder({ foodSubtotalPaise: 20000 }, cfg({ gstMode: 'registered_eco_9_5', platformGstin: '' })).onlineChargePaise).toBe(2000);
    expect(subscriptionGstBps({ gstMode: 'registered_fee_only', platformFeeGstBps: 1800, platformGstin: '' })).toBe(0);
    expect(subscriptionGstBps({ gstMode: 'unregistered', platformFeeGstBps: 1800, platformGstin: '36ABCDE1234F1Z5' })).toBe(0);
    expect(subscriptionGstBps({ gstMode: 'registered_fee_only', platformFeeGstBps: 1800, platformGstin: '36ABCDE1234F1Z5' })).toBe(1800);
  });
  test('credit reduces the fee before GST and never the food or the food GST', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000, availableCreditPaise: 500 }, cfg({ gstMode: 'registered_eco_9_5' }));
    expect(q).toMatchObject({ feeBeforeCreditPaise: 2000, creditAppliedPaise: 500, platformFeePaise: 1500, feeGstPaise: 270, ecoGstPaise: 1000, onlineChargePaise: 2770 });
    const big = quoteOrder({ foodSubtotalPaise: 20000, availableCreditPaise: 999_999 }, cfg());
    expect(big.creditAppliedPaise).toBe(2000);
    expect(big.onlineChargePaise).toBe(0);
  });
  test('property: every quote total is an integer sum of its parts', () => {
    for (const mode of ['unregistered', 'registered_fee_only', 'registered_eco_9_5']) for (let food = 0; food <= 300_000; food += 997) for (const credit of [0, 333, 5000]) {
      const q = quoteOrder({ foodSubtotalPaise: food, availableCreditPaise: credit }, cfg({ gstMode: mode }));
      expect(q.onlineChargePaise).toBe(q.platformFeePaise + q.feeGstPaise + q.ecoGstPaise);
      expect(q.grandTotalPaise).toBe(q.foodTotalPaise + q.onlineChargePaise);
      expect(Object.values(q).filter((v) => typeof v === 'number').every((v) => Number.isInteger(v))).toBe(true);
    }
  });
});

describe('PAN ↔ UPI name match', () => {
  test.each([
    ['KAMALA DEVI', 'Kamala Devi', 100],
    ['KAMALA DEVI', 'Devi Kamala', 100],
    ['Smt Kamala Devi', 'KAMALA DEVI', 100],
  ])('%s ~ %s ≥ 90', (a, b) => expect(nameMatchScore(a, b)).toBeGreaterThanOrEqual(90));
  test('initials, typos and strangers', () => {
    expect(nameMatchScore('KAMALA DEVI', 'K DEVI')).toBeGreaterThanOrEqual(70);
    expect(nameMatchScore('RAVI KUMAR', 'RAVI KUMER')).toBeGreaterThanOrEqual(80);
    expect(nameMatchScore('KAMALA DEVI', 'RAJESH SHARMA')).toBeLessThan(30);
    expect(nameMatchScore('', 'RAJESH')).toBe(0);
    expect(nameMatchScore(null, undefined)).toBe(0);
  });
});

describe('PAN', () => {
  test('format and masking', () => {
    expect(isValidPan('abcde1234f')).toBe(true);
    expect(isValidPan('ABCDE12345')).toBe(false);
    expect(isValidPan('1234567890')).toBe(false);
    expect(maskPan('abcde1234f')).toBe('ABCDE****F');
  });
});

describe('FSSAI tiers (derived, 2026 rules)', () => {
  const NOW = new Date('2026-12-01T06:00:00Z');
  const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
  const opts = { deemedDays: 7, provisionalMaxDays: 45, now: NOW };
  const filed = (n: number, status: 'filed_on_foscos' | 'rejected' | 'inspection_ordered' = 'filed_on_foscos') => ({ status, foscosRefNumber: 'REF1', filedAt: day(n), licenseType: 'registration' as const });
  const prof = (over: object = {}) => ({ fssaiStatus: 'unverified' as const, ...over });

  test('none → applied (inside the 7-day window) → provisional (after) → blocked (45 days later)', () => {
    expect(fssaiTierInfo(prof(), null, opts).tier).toBe('none');
    expect(fssaiTierInfo(prof(), filed(3), opts).tier).toBe('applied');
    expect(fssaiTierInfo(prof(), filed(7), opts).tier).toBe('applied'); // exactly day 7: window not yet passed
    expect(fssaiTierInfo(prof(), filed(8), opts).tier).toBe('provisional');
    expect(fssaiTierInfo(prof(), filed(7 + 44), opts).tier).toBe('provisional');
    expect(fssaiTierInfo(prof(), filed(7 + 46), opts).tier).toBe('blocked');
  });
  test('a recorded interruption (rejection / inspection) blocks; an application without a reference number never counts', () => {
    expect(fssaiTierInfo(prof(), filed(20, 'rejected'), opts).tier).toBe('blocked');
    expect(fssaiTierInfo(prof(), filed(20, 'inspection_ordered'), opts).tier).toBe('blocked');
    expect(fssaiTierInfo(prof(), { ...filed(20), foscosRefNumber: null }, opts).tier).toBe('none');
  });
  test('a number awaiting admin check is provisional; verified is verified; a lapsed certificate date blocks but a perpetual registration never expires', () => {
    expect(fssaiTierInfo(prof({ fssaiStatus: 'awaiting_admin_check', provisionalStartedAt: day(2) }), null, opts).tier).toBe('provisional');
    expect(fssaiTierInfo(prof({ fssaiStatus: 'awaiting_admin_check', provisionalStartedAt: day(60) }), null, opts).tier).toBe('blocked');
    expect(fssaiTierInfo(prof({ fssaiStatus: 'verified' }), null, opts).tier).toBe('verified');
    expect(fssaiTierInfo(prof({ fssaiStatus: 'verified', fssaiExpiry: null }), filed(500), opts).tier).toBe('verified');
    expect(fssaiTierInfo(prof({ fssaiStatus: 'verified', fssaiExpiry: '2026-01-01' }), null, opts).tier).toBe('blocked');
    expect(fssaiTierInfo(prof({ fssaiStatus: 'verified', fssaiExpiry: '2027-01-01' }), null, opts).tier).toBe('verified');
  });
  test('badges', () => {
    expect(tierBadge('provisional')?.label).toBe('FSSAI applied: provisional');
    expect(tierBadge('verified', '12345678901234')?.label).toBe('FSSAI registered · 12345678901234');
    expect(tierBadge('applied')).toBeNull();
    expect(tierBadge('none')).toBeNull();
  });
});

describe('provisional caps', () => {
  const settings = { provisionalMaxOrdersPerDay: 8, provisionalMaxFoodValuePerDayPaise: 250_000, provisionalMaxFoodValueTotalPaise: 2_500_000 };
  const limits = effectiveCaps(settings, null);
  test('defaults: 8 orders/day, ₹2,500/day, ₹25,000 total', () => {
    expect(limits).toEqual({ maxOrdersPerDay: 8, maxFoodValuePerDayPaise: 250_000, maxFoodValueTotalPaise: 2_500_000 });
    expect(checkCaps(limits, { ordersToday: 7, foodTodayPaise: 0, foodTotalPaise: 0 }, 10000).ok).toBe(true);
    expect(checkCaps(limits, { ordersToday: 8, foodTodayPaise: 0, foodTotalPaise: 0 }, 10000)).toMatchObject({ ok: false, reason: 'orders_per_day', message: 'Fully booked today' });
    expect(checkCaps(limits, { ordersToday: 1, foodTodayPaise: 245_000, foodTotalPaise: 0 }, 10000)).toMatchObject({ ok: false, reason: 'value_per_day' });
    expect(checkCaps(limits, { ordersToday: 1, foodTodayPaise: 0, foodTotalPaise: 2_495_000 }, 10000)).toMatchObject({ ok: false, reason: 'value_total' });
  });
  test('an admin override applies until it expires', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const o = { maxOrdersPerDay: 20, expiresAt: '2026-12-10T00:00:00Z' };
    expect(effectiveCaps(settings, o, now).maxOrdersPerDay).toBe(20);
    expect(effectiveCaps(settings, o, new Date('2026-12-11T00:00:00Z')).maxOrdersPerDay).toBe(8);
    expect(effectiveCaps(settings, { maxFoodValueTotalPaise: 9_999_999 }, now)).toMatchObject({ maxOrdersPerDay: 8, maxFoodValueTotalPaise: 9_999_999 });
  });
});

describe('financial year (IST)', () => {
  test('starts on 1 April', () => {
    expect(fyLabel(new Date('2026-11-06T10:00:00Z'))).toBe('2026-27');
    expect(fyLabel(new Date('2027-03-31T10:00:00Z'))).toBe('2026-27');
    expect(fyLabel(new Date('2027-04-01T10:00:00Z'))).toBe('2027-28');
    expect(fyStart(new Date('2026-11-06T10:00:00Z')).toISOString()).toBe('2026-03-31T18:30:00.000Z');
  });
});
