import type { sellerProfiles } from '@/lib/db/schema';
import { paymentDetailsOk } from './gate';

/** Version of the Kitchen Terms (seller agreement) a seller must have accepted. Bump on a material change. */
export const AGREEMENT_VERSION = '2026-11-draft1';

export const HYGIENE_ITEMS = [
  { key: 'clean_water', label: 'I use clean, safe drinking-quality water for cooking and washing' },
  { key: 'separate_storage', label: 'I store raw and cooked food separately' },
  { key: 'pest_control', label: 'My kitchen is kept free of pests, and food is covered' },
  { key: 'personal_hygiene', label: 'I wash my hands and keep my hair and nails covered/clean while cooking' },
  { key: 'no_cooking_ill', label: 'I do not cook for others when I am unwell' },
  { key: 'covered_transport', label: 'I carry food in clean, covered containers' },
  { key: 'allergen_awareness', label: 'I know the allergens in my dishes and will declare them honestly' },
] as const;

export const FOOD_MARKS = [
  { value: 'veg', label: 'Vegetarian only' },
  { value: 'veg_egg', label: 'Vegetarian + egg' },
  { value: 'non_veg', label: 'Non-vegetarian' },
] as const;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const MIN_KITCHEN_PHOTOS = 2;
export const MAX_KITCHEN_PHOTOS = 4;

export type StepKey = 'about' | 'kitchen' | 'hygiene' | 'fssai' | 'tax' | 'upi' | 'agreement' | 'dishes' | 'plan' | 'submit' | 'live';
export type Step = { key: StepKey; label: string; done: boolean; href: string; hint?: string };

type Profile = typeof sellerProfiles.$inferSelect;
export type OnboardingContext = { isMember: boolean; hasDish: boolean; planOk: boolean; fssaiStarted: boolean; foundingOffer: boolean };

/** Pure: which wizard steps are done. `plan` is only required when there is no free founding offer. */
export function evaluateSteps(p: Profile, ctx: OnboardingContext): Step[] {
  const photos = p.kitchenPhotosJson?.length ?? 0;
  const hygiene = p.hygieneDeclarationJson ?? {};
  const hygieneDone = HYGIENE_ITEMS.every((i) => !!hygiene[i.key]);
  return [
    { key: 'about', label: 'About you', done: !!p.legalName && !!p.displayName && !!p.kitchenName && ctx.isMember, href: '/seller/onboarding#about', hint: ctx.isMember ? undefined : 'Join your society first' },
    { key: 'kitchen', label: 'Your kitchen', done: (p.cuisinesJson?.length ?? 0) > 0 && (p.cookingDaysJson?.length ?? 0) > 0 && photos >= MIN_KITCHEN_PHOTOS && (p.offersSelfPickup || p.offersSellerDelivery), href: '/seller/onboarding#kitchen', hint: `${photos}/${MIN_KITCHEN_PHOTOS} photos` },
    { key: 'hygiene', label: 'Food-safety declaration', done: hygieneDone, href: '/seller/onboarding#hygiene' },
    { key: 'fssai', label: 'FSSAI registration', done: ctx.fssaiStarted, href: '/seller/compliance' },
    { key: 'tax', label: 'PAN', done: !!p.panMasked && !!p.panNameOnCard, href: '/seller/onboarding#tax' },
    { key: 'upi', label: 'UPI ID verified (₹1)', done: paymentDetailsOk(p), href: '/seller/payment-details' },
    { key: 'agreement', label: 'Kitchen agreement', done: p.agreementVersion === AGREEMENT_VERSION, href: '/seller/onboarding#agreement' },
    { key: 'dishes', label: 'Add your first dish', done: ctx.hasDish, href: '/seller/listings' },
    ...(ctx.foundingOffer ? [] : [{ key: 'plan' as const, label: 'Choose a listing plan', done: ctx.planOk, href: '/seller/subscription' }]),
  ];
}
