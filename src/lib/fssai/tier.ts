import type { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { istDateString } from '@/lib/time';

/**
 * Seller FSSAI tier — DERIVED from dates and statuses on every read, never
 * stored, so a missed cron can never leave a kitchen in the wrong tier.
 *
 *   none         no application, no number                            hidden
 *   applied      filed on FoSCoS, still inside the deemed window       hidden ("Coming soon" to own society if enabled)
 *   provisional  deemed window passed with no interruption, or a number awaiting admin check    visible, provisional caps
 *   verified     admin verified the number / certificate               visible, normal caps
 *   blocked      rejected, inspection/inadequacy pending, suspended, certificate expired, provisional period expired   hidden
 */
export type FssaiTier = 'none' | 'applied' | 'provisional' | 'verified' | 'blocked';

type Profile = Pick<typeof sellerProfiles.$inferSelect, 'fssaiStatus'> & {
  fssaiExpiry?: string | null;
  fssaiBlockedReason?: string | null;
  provisionalStartedAt?: Date | null;
};
type Application = Pick<typeof fssaiApplications.$inferSelect, 'status' | 'foscosRefNumber' | 'filedAt' | 'licenseType'> | null;

export type TierOptions = {
  /** Deemed-commencement window for Basic Registration (days). */
  deemedDays: number;
  /** Provisional selling stops after this many days without verification. */
  provisionalMaxDays: number;
  now?: Date;
};

export const DAY = 24 * 60 * 60 * 1000;

export type TierInfo = {
  tier: FssaiTier;
  /** When the provisional period started (deemed window end, or number entry). */
  provisionalSince: Date | null;
  /** When provisional selling will stop, if it is running. */
  provisionalEndsAt: Date | null;
  reason: string;
};

export function fssaiTierInfo(profile: Profile, app: Application, opts: TierOptions): TierInfo {
  const now = opts.now ?? new Date();
  const none = (tier: FssaiTier, reason: string): TierInfo => ({ tier, provisionalSince: null, provisionalEndsAt: null, reason });

  // An admin block overrides everything else (e.g. a certificate found to be forged).
  if (profile.fssaiBlockedReason) return none('blocked', `FSSAI blocked by PadosiPlate: ${profile.fssaiBlockedReason}`);
  if (profile.fssaiStatus === 'verified') {
    // Registrations are perpetual; only a certificate that shows an explicit expiry date can lapse.
    if (profile.fssaiExpiry && profile.fssaiExpiry < istDateString(now)) return none('blocked', 'FSSAI certificate expired');
    return none('verified', 'FSSAI registration verified');
  }
  // FoSCoS answered with a rejection / inspection / inadequacy notice → the deemed path never starts.
  if (app && ['rejected', 'inspection_ordered', 'inadequacy_notice'].includes(app.status)) {
    return none('blocked', app.status === 'rejected' ? 'FSSAI application rejected' : 'FSSAI inspection or notice pending');
  }

  let since: Date | null = null;
  if (app && app.status === 'filed_on_foscos' && app.foscosRefNumber && app.filedAt) {
    const windowEnd = new Date(app.filedAt.getTime() + opts.deemedDays * DAY);
    if (now.getTime() <= windowEnd.getTime()) return none('applied', `FSSAI applied — inside the ${opts.deemedDays}-day deemed window`);
    since = windowEnd;
  }
  if (profile.fssaiStatus === 'awaiting_admin_check') {
    const entered = profile.provisionalStartedAt ?? null;
    if (entered && (!since || entered.getTime() < since.getTime())) since = entered;
    if (!since) since = now;
  }
  if (!since) return none('none', 'No FSSAI application on file');

  const endsAt = new Date(since.getTime() + opts.provisionalMaxDays * DAY);
  if (opts.provisionalMaxDays > 0 && now.getTime() > endsAt.getTime()) {
    return { tier: 'blocked', provisionalSince: since, provisionalEndsAt: endsAt, reason: 'Provisional period ended without FSSAI verification' };
  }
  return { tier: 'provisional', provisionalSince: since, provisionalEndsAt: opts.provisionalMaxDays > 0 ? endsAt : null, reason: 'FSSAI applied: provisional' };
}

export const fssaiTier = (profile: Profile, app: Application, opts: TierOptions): FssaiTier => fssaiTierInfo(profile, app, opts).tier;

/** Tiers whose kitchens buyers can see and order from. */
export const BUYER_VISIBLE_TIERS: FssaiTier[] = ['verified', 'provisional'];
export const isBuyerVisibleTier = (t: FssaiTier) => BUYER_VISIBLE_TIERS.includes(t);

/** Badge copy: the buyer-facing statement of the tier. */
export function tierBadge(tier: FssaiTier, number?: string | null): { label: string; tone: 'green' | 'amber' | 'neutral' } | null {
  if (tier === 'verified') return { label: number ? `FSSAI registered · ${number}` : 'FSSAI registered', tone: 'green' };
  if (tier === 'provisional') return { label: 'FSSAI applied: provisional', tone: 'amber' };
  return null;
}

// ---------- provisional caps ----------

export type CapLimits = {
  maxOrdersPerDay: number;
  maxFoodValuePerDayPaise: number;
  maxFoodValueTotalPaise: number;
};

export type CapSettings = {
  provisionalMaxOrdersPerDay: number;
  provisionalMaxFoodValuePerDayPaise: number;
  provisionalMaxFoodValueTotalPaise: number;
};

/** Effective limits for a provisional kitchen: platform defaults overridden by an unexpired admin override. */
export function effectiveCaps(settings: CapSettings, override: sellerProfilesOverride | null | undefined, now: Date = new Date()): CapLimits {
  const live = override && (!override.expiresAt || new Date(override.expiresAt).getTime() > now.getTime()) ? override : null;
  return {
    maxOrdersPerDay: live?.maxOrdersPerDay ?? settings.provisionalMaxOrdersPerDay,
    maxFoodValuePerDayPaise: live?.maxFoodValuePerDayPaise ?? settings.provisionalMaxFoodValuePerDayPaise,
    maxFoodValueTotalPaise: live?.maxFoodValueTotalPaise ?? settings.provisionalMaxFoodValueTotalPaise,
  };
}
type sellerProfilesOverride = NonNullable<typeof sellerProfiles.$inferSelect['capOverrideJson']>;

export type CapUsage = { ordersToday: number; foodTodayPaise: number; foodTotalPaise: number };

export type CapCheck = { ok: true } | { ok: false; reason: 'orders_per_day' | 'value_per_day' | 'value_total'; message: string };

/** Would adding one more order of `foodPaise` breach a provisional cap? Pure; the DB read of `usage` happens under a lock. */
export function checkCaps(limits: CapLimits, usage: CapUsage, foodPaise: number): CapCheck {
  if (usage.ordersToday + 1 > limits.maxOrdersPerDay) return { ok: false, reason: 'orders_per_day', message: 'Fully booked today' };
  if (usage.foodTodayPaise + foodPaise > limits.maxFoodValuePerDayPaise) return { ok: false, reason: 'value_per_day', message: 'Fully booked today' };
  if (usage.foodTotalPaise + foodPaise > limits.maxFoodValueTotalPaise) return { ok: false, reason: 'value_total', message: 'This kitchen has reached its provisional sales limit' };
  return { ok: true };
}
