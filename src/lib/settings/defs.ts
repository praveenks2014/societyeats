import { z } from 'zod';
import { DEFAULTS } from '@/lib/config';

/**
 * Every admin-tunable platform setting, in one table: type, bounds, default,
 * label and grouping. The same table drives (1) getPlatformSettings(),
 * (2) PATCH /api/admin/settings validation and (3) the /admin/settings UI, so
 * a money or percentage field can never be saved without an integer + bounds
 * check. Money is stored as integer paise, percentages as integer basis
 * points (1% = 100 bps).
 */
type Base = { label: string; hint?: string; group: string };
export type IntDef = Base & { kind: 'int'; min: number; max: number; def: number; unit?: 'paise' | 'bps' | 'count' | 'days' | 'minutes' | 'rupees' };
export type NumDef = Base & { kind: 'number'; min: number; max: number; def: number; unit?: 'pct' | 'km' };
export type BoolDef = Base & { kind: 'bool'; def: boolean };
export type TextDef = Base & { kind: 'text'; def: string; pattern?: RegExp; patternHint?: string; maxLen?: number };
export type EnumDef = Base & { kind: 'enum'; options: readonly string[]; def: string };
export type Def = IntDef | NumDef | BoolDef | TextDef | EnumDef;

export const SETTING_DEFS = {
  // ---- buyer platform fee (the platform's revenue on every order) ----
  buyerPlatformFeeBps: { kind: 'int', unit: 'bps', min: 0, max: 2500, def: 1000, group: 'Pricing', label: 'Buyer platform fee (%)', hint: '% of the food value, paid by the buyer via Razorpay. 0–25%. Default 10.' },
  buyerPlatformFeeMinPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: 0, group: 'Pricing', label: 'Platform fee floor (₹)', hint: 'Minimum fee per order. 0 = no floor.' },
  buyerPlatformFeeMaxPaise: { kind: 'int', unit: 'paise', min: 0, max: 1_000_000, def: 0, group: 'Pricing', label: 'Platform fee cap (₹)', hint: 'Maximum fee per order. 0 = no cap.' },
  platformFeeGstBps: { kind: 'int', unit: 'bps', min: 0, max: 2800, def: 1800, group: 'Tax', label: 'GST on platform fee & subscriptions (%)', hint: 'Applied only when a platform GSTIN is entered below; otherwise 0.' },
  platformGstin: { kind: 'text', def: '', maxLen: 15, pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, patternHint: 'a valid 15-character GSTIN, or blank', group: 'Tax', label: 'Platform GSTIN', hint: 'Leave blank until registered — GST is then not charged.' },
  ecoFoodGstMode: { kind: 'enum', options: ['off', 'collect_with_platform_fee'], def: 'off', group: 'Tax', label: 'E-commerce-operator food GST (Sec 9(5))', hint: '⚠️ Confirm GST treatment with your CA before going live. "collect_with_platform_fee" adds 5% of the food value to the Razorpay charge and records it as ECO GST payable.' },
  ecoFoodGstBps: { kind: 'int', unit: 'bps', min: 0, max: 2800, def: 500, group: 'Tax', label: 'ECO food GST rate (%)', hint: 'Used only when the mode above is on. Default 5.' },
  // ---- subscriptions ----
  subscriptionGraceDays: { kind: 'int', unit: 'days', min: 0, max: 30, def: 3, group: 'Subscriptions', label: 'Grace period after expiry (days)', hint: 'Listings stay visible, with a banner, during grace.' },
  subscriptionReminderDays: { kind: 'text', def: '7,1', pattern: /^\d{1,2}(,\d{1,2}){0,4}$/, patternHint: 'comma-separated days like 7,1', group: 'Subscriptions', label: 'Renewal reminders (days before expiry)', hint: 'Comma-separated, e.g. 7,1.' },
  // ---- order timing ----
  unpaidOrderExpiryMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 120, def: 15, group: 'Orders', label: 'Unpaid-fee order expiry (minutes)', hint: 'Orders whose platform fee is unpaid expire and release stock.' },
  sellerAcceptWindowMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 120, def: 15, group: 'Orders', label: 'Kitchen acceptance window (minutes)', hint: 'Unaccepted orders auto-cancel and the platform fee is refunded.' },
  kitchenPaymentConfirmMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 240, def: 30, group: 'Orders', label: 'Kitchen UPI-confirmation reminder (minutes)', hint: 'After this long, both sides and admin are notified. Orders are never auto-cancelled for it.' },
  radiusKm: { kind: 'number', unit: 'km', min: 1, max: 50, def: DEFAULTS.radiusKm, group: 'Orders', label: 'Nearby radius (km)', hint: 'The hyperlocal boundary. Default 10.' },
  // ---- moderation & flags ----
  dishModerationEnabled: { kind: 'bool', def: true, group: 'Moderation', label: 'Dish moderation', hint: 'New dishes, and dishes whose name/photo changes or price moves >30%, wait for admin review.' },
  restaurantConsoleEnabled: { kind: 'bool', def: false, group: 'Feature flags', label: 'Restaurant (Mall) console', hint: 'Off for the pilot.' },
  mallModeEnabled: { kind: 'bool', def: DEFAULTS.mallModeEnabled, group: 'Feature flags', label: 'Mall Mode', hint: 'Off for the pilot.' },
  platformDeliveryEnabled: { kind: 'bool', def: DEFAULTS.platformDeliveryEnabled, group: 'Feature flags', label: 'Delivery-partner overflow', hint: 'Third-party delivery. Off for the pilot.' },
  // ---- FSSAI ----
  fssaiBasicFeePerYear: { kind: 'int', unit: 'rupees', min: 0, max: 10_000, def: 100, group: 'FSSAI', label: 'FSSAI Basic Registration fee per year (₹)', hint: 'Shown to sellers in the assistant. Government fee, paid directly to FSSAI.' },
  fssaiDocRetentionDays: { kind: 'int', unit: 'days', min: 0, max: 365, def: 30, group: 'FSSAI', label: 'ID document retention after verification (days)', hint: 'ID/address documents are auto-deleted this long after verification.' },
  platformFssaiCentralLicenseNo: { kind: 'text', def: DEFAULTS.platformFssaiCentralLicenseNo, pattern: /^\d{14}$/, patternHint: 'a 14-digit FSSAI licence number, or blank', group: 'FSSAI', label: 'Platform FSSAI licence no.', hint: 'The platform’s own e-commerce registration. Required before real (non-mock) orders.' },
  fssaiSponsorshipCapPerCohort: { kind: 'int', unit: 'count', min: 0, max: 1000, def: DEFAULTS.fssaiSponsorshipCapPerCohort, group: 'FSSAI', label: 'Legacy FSSAI sponsorship cap', hint: 'Legacy facilitation cohort cap.' },
  // ---- referrals ----
  referralCreditPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: DEFAULTS.referralCreditPaise, group: 'Referrals', label: 'Referral credit (₹)', hint: 'Credited to the referrer when a referred neighbour completes their first order. Applies to the platform fee only.' },
  referralCreditCapPerUser: { kind: 'int', unit: 'count', min: 0, max: 100, def: DEFAULTS.referralCreditCapPerUser, group: 'Referrals', label: 'Referral credits per user (lifetime)' },
  featuredSellerId: { kind: 'text', def: '', pattern: /^\d*$/, patternHint: 'a kitchen user id or blank', group: 'Referrals', label: 'Featured kitchen (user id)' },
  // ---- legal identity shown on invoices / legal pages ----
  legalEntityName: { kind: 'text', def: '', maxLen: 160, group: 'Legal', label: 'Legal entity name', hint: 'Overrides the placeholder on invoices and legal pages.' },
  registeredAddress: { kind: 'text', def: '', maxLen: 300, group: 'Legal', label: 'Registered address' },
  grievanceOfficer: { kind: 'text', def: '', maxLen: 200, group: 'Legal', label: 'Grievance officer (name, email)' },
  // ---- mall mode (flag off) ----
  commissionMallPct: { kind: 'number', unit: 'pct', min: 0, max: 50, def: DEFAULTS.commissionMallPct, group: 'Mall Mode', label: 'Mall commission (%)' },
  platformFeePaise: { kind: 'int', unit: 'paise', min: 0, max: 50_000, def: DEFAULTS.platformFeePaise, group: 'Mall Mode', label: 'Mall flat buyer fee (₹)' },
  platformDeliveryFeeInPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: DEFAULTS.platformDeliveryFeeInPaise, group: 'Mall Mode', label: 'Delivery-partner fallback fee (₹)' },
  platformDeliveryMinOrderPaise: { kind: 'int', unit: 'paise', min: 0, max: 1_000_000, def: DEFAULTS.platformDeliveryMinOrderPaise, group: 'Mall Mode', label: 'Delivery-partner minimum order (₹)' },
  // ---- pilot metrics ----
  killWeek8PenetrationPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek8PenetrationPct, group: 'Pilot metrics', label: 'Week 8 — min penetration (%)' },
  killWeek8RetentionPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek8RetentionPct, group: 'Pilot metrics', label: 'Week 8 — min week-4 retention (%)' },
  killWeek14PenetrationPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek14PenetrationPct, group: 'Pilot metrics', label: 'Week 14 — min penetration (%)' },
  killWeek14RetentionPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek14RetentionPct, group: 'Pilot metrics', label: 'Week 14 — min week-4 retention (%)' },
} as const satisfies Record<string, Def>;

export type SettingKey = keyof typeof SETTING_DEFS;

type ValueOf<D> = D extends { kind: 'bool' }
  ? boolean
  : D extends { kind: 'int' | 'number' }
    ? number
    : D extends { kind: 'enum'; options: infer O extends readonly string[] }
      ? O[number]
      : string;

export type PlatformSettings = { [K in SettingKey]: ValueOf<(typeof SETTING_DEFS)[K]> };

/** zod validator for one setting (integers enforced, bounds enforced). */
export function validatorFor(key: SettingKey): z.ZodTypeAny {
  const d = SETTING_DEFS[key] as Def;
  switch (d.kind) {
    case 'int':
      return z.number({ invalid_type_error: `${d.label} must be a whole number` }).int(`${d.label} must be a whole number`).min(d.min, `${d.label} must be at least ${d.min}`).max(d.max, `${d.label} must be at most ${d.max}`);
    case 'number':
      return z.number({ invalid_type_error: `${d.label} must be a number` }).finite().min(d.min, `${d.label} must be at least ${d.min}`).max(d.max, `${d.label} must be at most ${d.max}`);
    case 'bool':
      return z.boolean({ invalid_type_error: `${d.label} must be true or false` });
    case 'enum':
      return z.enum(d.options as [string, ...string[]], { errorMap: () => ({ message: `${d.label} must be one of ${d.options.join(', ')}` }) });
    case 'text':
      return z
        .string()
        .trim()
        .max(d.maxLen ?? 300, `${d.label} is too long`)
        .refine((v) => v === '' || !d.pattern || d.pattern.test(v), `${d.label} must be ${d.patternHint ?? 'valid'}`);
  }
}

/** Validates a PATCH body. Throws a ZodError-like message list via `errors`. */
export function parseSettingsPatch(body: unknown): { values: Partial<Record<SettingKey, string | number | boolean>>; errors: string[] } {
  const values: Partial<Record<SettingKey, string | number | boolean>> = {};
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { values, errors: ['Body must be an object'] };
  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    if (!(key in SETTING_DEFS)) {
      errors.push(`Unknown setting: ${key}`);
      continue;
    }
    const r = validatorFor(key as SettingKey).safeParse(raw);
    if (!r.success) errors.push(r.error.issues[0].message);
    else values[key as SettingKey] = r.data as string | number | boolean;
  }
  return { values, errors };
}

/** Cross-field rules, checked against the merged result. */
export function crossCheck(merged: PlatformSettings): string[] {
  const errs: string[] = [];
  if (merged.buyerPlatformFeeMaxPaise > 0 && merged.buyerPlatformFeeMaxPaise < merged.buyerPlatformFeeMinPaise) {
    errs.push('Platform fee cap must be at least the floor (or 0 for no cap)');
  }
  return errs;
}

export function parseReminderDays(csv: string): number[] {
  return [...new Set(csv.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => b - a);
}
