import { describe, expect, test } from 'vitest';
import { checkDishText, validatePackaged, allergensToColumns, isVegFromMark } from '@/lib/dishes/rules';
import { listingCreateSchema } from '@/lib/seller';
import { priceBreakdown } from '@/lib/money/price-breakdown';
import { feeConfigFromSettings } from '@/lib/money';

const ok = { title: 'Dal', priceRupees: 100, cuisine: 'Tiffins', foodMark: 'veg', ingredients: 'dal, rice', allergens: ['none'], availableQty: 5 };

describe('dish rules', () => {
  test('prohibited items are blocked by word, not substring', () => {
    expect(checkDishText({ title: 'Rum cake' }).blockedReason).toMatch(/rum/);
    expect(checkDishText({ title: 'Homemade wine' }).blockedReason).toBeTruthy();
    expect(checkDishText({ title: 'Raw chicken pieces' }).blockedReason).toBeTruthy();
    expect(checkDishText({ title: 'Drumstick sambar' }).blockedReason).toBeNull(); // contains "rum" inside a word
    expect(checkDishText({ title: 'Dal', ingredients: 'infant formula' }).blockedReason).toBeTruthy();
  });
  test('admin keyword list is honoured', () => {
    expect(checkDishText({ title: 'Kombucha' }, 'kombucha').blockedReason).toBeTruthy();
    expect(checkDishText({ title: 'Rum cake' }, 'kombucha').blockedReason).toBeNull();
  });
  test('health claims are soft matches (moderation), not blocks', () => {
    const r = checkDishText({ title: 'Immunity booster soup' });
    expect(r.blockedReason).toBeNull();
    expect(r.healthClaim).toBe('immunity booster');
    expect(checkDishText({ title: 'Weight loss salad' }).healthClaim).toBe('weight loss');
    expect(checkDishText({ title: 'Plain salad' }).healthClaim).toBeNull();
  });
  test('schema: food mark, ingredients and an allergen choice are required', () => {
    expect(listingCreateSchema.safeParse(ok).success).toBe(true);
    expect(listingCreateSchema.safeParse({ ...ok, foodMark: undefined }).success).toBe(false);
    expect(listingCreateSchema.safeParse({ ...ok, ingredients: '' }).success).toBe(false);
    expect(listingCreateSchema.safeParse({ ...ok, allergens: [] }).success).toBe(false);
    expect(listingCreateSchema.safeParse({ ...ok, allergens: ['none', 'milk'] }).success).toBe(false);
    expect(listingCreateSchema.safeParse({ ...ok, allergens: ['milk', 'nuts'] }).success).toBe(true);
    expect(listingCreateSchema.safeParse({ ...ok, photos: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });
  test('packaged foods need the flag and every label field', () => {
    const p = { netQuantity: '250 g', manufactureDate: '2026-11-01', bestBefore: '2026-12-01', makerName: 'A', makerAddress: 'B-1204, Heights' };
    expect(validatePackaged(false, null, false)).toBeNull();
    expect(validatePackaged(true, p, false)).toMatch(/not enabled/);
    expect(validatePackaged(true, p, true)).toBeNull();
    expect(validatePackaged(true, { ...p, makerName: '' }, true)).toMatch(/Maker name/);
  });
  test('columns: allergen "none" stores an empty list but marks it declared; only a veg mark is isVeg', () => {
    expect(allergensToColumns(['none'])).toEqual({ allergensJson: [], allergensDeclared: true });
    expect(allergensToColumns(['milk'])).toEqual({ allergensJson: ['milk'], allergensDeclared: true });
    expect(isVegFromMark('veg')).toBe(true);
    expect(isVegFromMark('egg')).toBe(false);
  });
});

describe('priceBreakdown matches the fee engine in every GST mode', () => {
  const base = { buyerPlatformFeeBps: 1000, buyerPlatformFeeMinPaise: 1000, buyerPlatformFeeMaxPaise: 2500, platformFeeGstBps: 1800, platformGstin: '36ABCDE1234F1Z5', ecoFoodGstBps: 500 };
  test.each([
    ['unregistered', 20000, 2000, 0, 0],
    ['registered_fee_only', 20000, 2000, 360, 0],
    ['registered_eco_9_5', 20000, 2000, 360, 1000],
  ])('%s', (mode, food, fee, feeGst, ecoGst) => {
    const b = priceBreakdown(food, feeConfigFromSettings({ ...base, gstMode: mode }));
    expect(b.quote.platformFeePaise).toBe(fee);
    expect(b.quote.feeGstPaise).toBe(feeGst);
    expect(b.quote.ecoGstPaise).toBe(ecoGst);
    expect(b.payNowPaise).toBe(fee + feeGst + ecoGst);
    expect(b.payAtDoorPaise).toBe(food);
    expect(b.lines.some((l) => l.key === 'fee_gst')).toBe(feeGst > 0);
    expect(b.lines.some((l) => l.key === 'food_gst')).toBe(ecoGst > 0);
    expect(b.summary).toContain('pay the kitchen at your door');
    expect(b.summary).toContain('(pay now)');
  });
  test('credit shows as its own negative line', () => {
    const b = priceBreakdown(20000, feeConfigFromSettings({ ...base, gstMode: 'unregistered' }), 500);
    expect(b.lines.find((l) => l.key === 'credit')?.amountPaise).toBe(-500);
    expect(b.payNowPaise).toBe(1500);
  });
});
