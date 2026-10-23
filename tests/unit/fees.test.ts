import { describe, expect, test } from 'vitest';
import { bpsOf, effectiveGstBps, platformFeeBase, quoteOrder, splitGst, subscriptionCharge, type FeeConfig } from '@/lib/money/fees';

const base: FeeConfig = { feeBps: 1000, feeMinPaise: 0, feeMaxPaise: 0, feeGstBps: 0, ecoMode: 'off', ecoBps: 500 };

describe('platform fee', () => {
  test('10% of food, rounded to whole paise', () => {
    expect(platformFeeBase(20000, base)).toBe(2000); // ₹200 → ₹20
    expect(platformFeeBase(12345, base)).toBe(1235); // 1234.5 → half-up
    expect(platformFeeBase(12344, base)).toBe(1234);
    expect(platformFeeBase(5, base)).toBe(1); // 0.5 → 1
    expect(platformFeeBase(4, base)).toBe(0);
  });

  test('floor and cap apply after the percentage', () => {
    expect(platformFeeBase(10000, { ...base, feeMinPaise: 1500 })).toBe(1500);
    expect(platformFeeBase(100000, { ...base, feeMaxPaise: 5000 })).toBe(5000);
    expect(platformFeeBase(30000, { ...base, feeMinPaise: 1500, feeMaxPaise: 5000 })).toBe(3000);
    expect(platformFeeBase(100000, { ...base, feeMinPaise: 1500, feeMaxPaise: 5000 })).toBe(5000);
  });

  test('0% and 25% bounds', () => {
    expect(platformFeeBase(20000, { ...base, feeBps: 0 })).toBe(0);
    expect(platformFeeBase(20000, { ...base, feeBps: 2500 })).toBe(5000);
  });

  test('bpsOf is exact half-up integer maths', () => {
    expect(bpsOf(1, 5000)).toBe(1);
    expect(bpsOf(199, 1000)).toBe(20);
    expect(bpsOf(0, 1800)).toBe(0);
  });
});

describe('quoteOrder', () => {
  test('headline case: food ₹200 → ₹20 platform fee, grand total ₹220', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000 }, base);
    expect(q).toMatchObject({ foodTotalPaise: 20000, platformFeePaise: 2000, feeGstPaise: 0, ecoGstPaise: 0, onlineChargePaise: 2000, grandTotalPaise: 22000 });
  });

  test('seller-delivery fee is part of the FOOD amount, not of the platform fee base', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000, sellerDeliveryFeePaise: 3000 }, base);
    expect(q.foodTotalPaise).toBe(23000);
    expect(q.platformFeePaise).toBe(2000);
    expect(q.onlineChargePaise).toBe(2000);
    expect(q.grandTotalPaise).toBe(25000);
  });

  test('GST on the fee only (not on food) when a GSTIN exists', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000 }, { ...base, feeGstBps: 1800 });
    expect(q.feeGstPaise).toBe(360);
    expect(q.onlineChargePaise).toBe(2360);
    expect(effectiveGstBps(1800, '')).toBe(0);
    expect(effectiveGstBps(1800, '   ')).toBe(0);
    expect(effectiveGstBps(1800, '36ABCDE1234F1Z5')).toBe(1800);
  });

  test('ECO food GST mode adds 5% of the food subtotal to the Razorpay charge', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000, sellerDeliveryFeePaise: 3000 }, { ...base, ecoMode: 'collect_with_platform_fee' });
    expect(q.ecoGstPaise).toBe(1000); // 5% of 20000, delivery excluded
    expect(q.onlineChargePaise).toBe(3000);
    expect(q.grandTotalPaise).toBe(26000);
    expect(quoteOrder({ foodSubtotalPaise: 20000 }, base).ecoGstPaise).toBe(0);
  });

  test('referral credit reduces only the fee and is capped at the fee (never negative)', () => {
    const part = quoteOrder({ foodSubtotalPaise: 20000, availableCreditPaise: 500 }, base);
    expect(part).toMatchObject({ creditAppliedPaise: 500, platformFeePaise: 1500, onlineChargePaise: 1500 });
    const big = quoteOrder({ foodSubtotalPaise: 20000, availableCreditPaise: 99999 }, base);
    expect(big).toMatchObject({ creditAppliedPaise: 2000, platformFeePaise: 0, onlineChargePaise: 0 });
    // credit never absorbs the statutory ECO GST
    const eco = quoteOrder({ foodSubtotalPaise: 20000, availableCreditPaise: 99999 }, { ...base, ecoMode: 'collect_with_platform_fee' });
    expect(eco.platformFeePaise).toBe(0);
    expect(eco.onlineChargePaise).toBe(1000);
  });

  test('GST is on the fee AFTER credit', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000, availableCreditPaise: 1000 }, { ...base, feeGstBps: 1800 });
    expect(q.platformFeePaise).toBe(1000);
    expect(q.feeGstPaise).toBe(180);
    expect(q.onlineChargePaise).toBe(1180);
  });

  test('a charge between 1 and 99 paise is topped up to Razorpay’s ₹1 minimum', () => {
    const q = quoteOrder({ foodSubtotalPaise: 300 }, base); // fee 30p
    expect(q.onlineChargePaise).toBe(100);
    expect(q.gatewayTopUpPaise).toBe(70);
    expect(quoteOrder({ foodSubtotalPaise: 20000, availableCreditPaise: 1990 }, base).onlineChargePaise).toBe(100);
  });

  test('integers all the way and totals add up', () => {
    for (const food of [1, 99, 100, 333, 1999, 12345, 987654]) {
      for (const cfg of [base, { ...base, feeGstBps: 1800, ecoMode: 'collect_with_platform_fee' as const }, { ...base, feeBps: 1234, feeMinPaise: 700, feeMaxPaise: 9000, feeGstBps: 1800 }]) {
        const q = quoteOrder({ foodSubtotalPaise: food, sellerDeliveryFeePaise: 2500, availableCreditPaise: 77 }, cfg);
        for (const v of [q.platformFeePaise, q.feeGstPaise, q.ecoGstPaise, q.onlineChargePaise, q.grandTotalPaise]) expect(Number.isInteger(v) && v >= 0).toBe(true);
        expect(q.onlineChargePaise).toBe(q.platformFeePaise + q.feeGstPaise + q.ecoGstPaise);
        expect(q.grandTotalPaise).toBe(q.foodTotalPaise + q.onlineChargePaise);
      }
    }
  });

  test('rates are snapshotted into the quote', () => {
    const q = quoteOrder({ foodSubtotalPaise: 20000 }, { ...base, feeBps: 1200 });
    expect(q.snapshot.feeBps).toBe(1200);
    expect(q.platformFeePaise).toBe(2400);
  });
});

describe('subscription and GST split', () => {
  test('subscription price is the base; GST is added only with a GSTIN', () => {
    expect(subscriptionCharge(29900, 0)).toMatchObject({ gstPaise: 0, totalPaise: 29900 });
    expect(subscriptionCharge(29900, 1800)).toMatchObject({ gstPaise: 5382, totalPaise: 35282 });
  });
  test('CGST + SGST always sum to the GST', () => {
    for (const g of [0, 1, 5, 5382, 5383]) {
      const { cgst, sgst } = splitGst(g);
      expect(cgst + sgst).toBe(g);
    }
  });
});
