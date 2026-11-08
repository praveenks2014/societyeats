/**
 * Dish rules (Pilot v2 step 5): allergen list, food mark, packaged-food fields
 * and the prohibited / health-claim checks. Pure functions: the admin-editable
 * keyword list is passed in from settings.
 */
import { z } from 'zod';
import { BRAND } from '@/config/brand';

export const ALLERGENS = ['gluten', 'milk', 'nuts', 'peanuts', 'soy', 'egg', 'fish', 'shellfish', 'sesame', 'mustard'] as const;
export const FOOD_MARKS = ['veg', 'egg', 'non_veg'] as const;
export const SPICE_LEVELS = ['mild', 'medium', 'hot'] as const;
export type FoodMark = (typeof FOOD_MARKS)[number];

/** Hard-blocked: never sellable through a home kitchen. Admin can extend via the `prohibitedKeywords` setting. */
export const DEFAULT_PROHIBITED_KEYWORDS =
  'alcohol,liquor,beer,wine,whisky,whiskey,vodka,rum,bhang,cannabis,ganja,weed,raw meat,raw chicken,raw fish,raw mutton,home canned,home-canned,canned at home,infant formula,baby formula,baby food,protein powder,supplement,vitamin tablet';

/** Soft match: not blocked, but the dish goes to moderation. */
export const HEALTH_CLAIM_KEYWORDS = ['cure', 'cures', 'diabetic-safe', 'diabetic safe', 'immunity booster', 'boosts immunity', 'weight loss', 'lose weight', 'treats', 'detox', 'fat burning', 'prevents cancer'];

export function parseKeywordList(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasWord(haystack: string, kw: string): boolean {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, 'i').test(haystack);
}

export type DishTextCheck = { blockedReason: string | null; healthClaim: string | null };

/** Looks at everything the buyer reads: name, description, ingredients, cuisine. */
export function checkDishText(parts: { title: string; description?: string | null; ingredients?: string | null; cuisine?: string | null }, prohibitedCsv: string = DEFAULT_PROHIBITED_KEYWORDS): DishTextCheck {
  const text = [parts.title, parts.description, parts.ingredients, parts.cuisine].filter(Boolean).join(' \n ').toLowerCase();
  for (const kw of parseKeywordList(prohibitedCsv)) {
    if (hasWord(text, kw)) return { blockedReason: `“${kw}” cannot be sold on ${BRAND.name} (see Prohibited items).`, healthClaim: null };
  }
  const claim = HEALTH_CLAIM_KEYWORDS.find((kw) => hasWord(text, kw)) ?? null;
  return { blockedReason: null, healthClaim: claim };
}

const packagedSchema = z.object({
  netQuantity: z.string().trim().min(1, 'Net quantity required for packaged food').max(40),
  manufactureDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of manufacture required (YYYY-MM-DD)'),
  bestBefore: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Best-before date required (YYYY-MM-DD)'),
  makerName: z.string().trim().min(1, 'Maker name required').max(120),
  makerAddress: z.string().trim().min(3, 'Maker address required').max(300),
});

/** The Pilot v2 dish fields, validated together with the base fields in `listingCreateSchema`. */
export const dishRulesShape = {
  foodMark: z.enum(FOOD_MARKS, { error: 'Choose veg, egg or non-veg' }),
  ingredients: z.string().trim().min(3, 'List the ingredients').max(1000),
  /** At least one allergen, or `none` (the “none of these” choice). */
  allergens: z
    .array(z.enum([...ALLERGENS, 'none'] as [string, ...string[]]))
    .min(1, 'Tick the allergens, or “none of these”')
    .refine((a) => !(a.includes('none') && a.length > 1), '“None of these” cannot be combined with an allergen'),
  spiceLevel: z.enum(SPICE_LEVELS).optional().nullable(),
  portionSize: z.string().trim().max(60).optional().nullable(),
  bestWithinHours: z.number().int().min(1).max(168).optional().nullable(),
  storageAdvice: z.string().trim().max(300).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(14).default(0),
  maxPortionsPerSlot: z.number().int().min(1).max(500).optional().nullable(),
  photos: z.array(z.string().trim().max(500)).max(4).optional(),
  isPackaged: z.boolean().default(false),
  packaged: packagedSchema.optional().nullable(),
};

/** Cross-field rules shared by create and patch. Returns an error message, or null. */
export function validatePackaged(isPackaged: boolean, packaged: unknown, packagedFoodsEnabled: boolean): string | null {
  if (!isPackaged) return null;
  if (!packagedFoodsEnabled) return 'Packaged foods are not enabled during the pilot.';
  const r = packagedSchema.safeParse(packaged);
  return r.success ? null : r.error.issues[0].message;
}

export function allergensToColumns(allergens: string[]): { allergensJson: string[]; allergensDeclared: boolean } {
  return { allergensJson: allergens.filter((a) => a !== 'none'), allergensDeclared: true };
}

/** `isVeg` stays as the legacy boolean the feed filters use: only a pure-veg mark is veg. */
export function isVegFromMark(mark: FoodMark): boolean {
  return mark === 'veg';
}
