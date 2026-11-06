import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { fssaiApplications, sellerProfiles, users } from '@/lib/db/schema';
import { isFssaiEligibleToPublish } from '@/lib/fssai/gate';
import { sellerIsSubscribed } from '@/lib/subscriptions/queries';

/** True while the kitchen has switched on “Not taking orders today”. */
export function isClosedToday(closedUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return !!closedUntil && closedUntil.getTime() > now.getTime();
}

/** A UPI VPA looks like name@bank (letters, digits, . _ -). */
export const VPA_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/;

export type GateResult = {
  ok: boolean;
  checks: { approved: boolean; subscribed: boolean; fssai: boolean; paymentDetails: boolean; notBlocked: boolean; notPaused: boolean; openToday: boolean };
  /** Human-readable reasons for the checks that failed. */
  reasons: string[];
};

type ProfileLike = Pick<typeof sellerProfiles.$inferSelect, 'listingState' | 'fssaiStatus' | 'fssaiExpiry' | 'upiVpa' | 'upiVerifyStatus' | 'upiVerifiedVpa' | 'listingsPausedReason'> & { provisionalStartedAt?: Date | null; closedUntil?: Date | null };

/**
 * Pilot v2: food is paid at the door by UPI to the VPA that passed the ₹1 ownership check. The VPA on the
 * profile must still be the verified one — changing it pauses the kitchen until it is verified again.
 */
export function paymentDetailsOk(p: Pick<ProfileLike, 'upiVpa' | 'upiVerifyStatus' | 'upiVerifiedVpa'>): boolean {
  if (!p.upiVpa || !VPA_RE.test(p.upiVpa)) return false;
  return p.upiVerifyStatus === 'verified' && !!p.upiVerifiedVpa && p.upiVerifiedVpa.toLowerCase() === p.upiVpa.toLowerCase();
}

/**
 * Pure combination of the four requirements for a kitchen to accept orders:
 *   1. admin has approved the kitchen
 *   2. subscription active or in grace (or admin-waived)
 *   3. FSSAI publishing gate passes (incl. licence expiry)
 *   4. a VPA on file, or pay-at-pickup is the only mode offered
 */
export function evaluateGate(input: {
  profile: ProfileLike;
  application: Parameters<typeof isFssaiEligibleToPublish>[1];
  subscribed: boolean;
  userBlocked: boolean;
  now?: Date;
  fssaiOpts?: { deemedDays?: number; provisionalMaxDays?: number };
}): GateResult {
  const checks = {
    approved: input.profile.listingState === 'approved',
    subscribed: input.subscribed,
    fssai: isFssaiEligibleToPublish(input.profile, input.application, input.now, input.fssaiOpts),
    paymentDetails: paymentDetailsOk(input.profile),
    notBlocked: !input.userBlocked,
    notPaused: !input.profile.listingsPausedReason,
    openToday: !isClosedToday(input.profile.closedUntil, input.now),
  };
  const reasons: string[] = [];
  if (!checks.approved) reasons.push('Kitchen is not approved by PadosiPlate');
  if (!checks.subscribed) reasons.push('Kitchen subscription is not active');
  if (!checks.fssai) reasons.push('FSSAI requirement not met');
  if (!checks.paymentDetails) reasons.push('UPI ID not verified — complete the ₹1 ownership check');
  if (!checks.openToday) reasons.push('Closed today — not taking orders');
  if (!checks.notPaused) reasons.push('Kitchen is paused pending admin review');
  if (!checks.notBlocked) reasons.push('Account is blocked');
  return { ok: Object.values(checks).every(Boolean), checks, reasons };
}

export async function kitchenGate(sellerId: number, now: Date = new Date()): Promise<GateResult & { profile: typeof sellerProfiles.$inferSelect | null }> {
  const db = await getDb();
  const [row] = await db
    .select({ profile: sellerProfiles, blockedAt: users.blockedAt })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .where(eq(sellerProfiles.userId, sellerId));
  if (!row) return { ok: false, checks: { approved: false, subscribed: false, fssai: false, paymentDetails: false, notBlocked: false, notPaused: false, openToday: false }, reasons: ['Kitchen not found'], profile: null };
  const [application] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, sellerId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const subscribed = await sellerIsSubscribed(sellerId, now);
  const settings = await getPlatformSettings();
  const result = evaluateGate({ profile: row.profile, application: application ?? null, subscribed, userBlocked: !!row.blockedAt, now, fssaiOpts: { deemedDays: settings.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: settings.provisionalMaxDays } });
  return { ...result, profile: row.profile };
}

/** The restaurant (Mall) console is feature-flagged off for the pilot. */
export async function assertRestaurantConsoleEnabled(): Promise<void> {
  const { getPlatformSettings } = await import('@/lib/db/platform');
  const { ApiError } = await import('@/lib/api');
  const s = await getPlatformSettings();
  if (!s.restaurantConsoleEnabled) throw new ApiError(404, 'The restaurant console is not enabled');
}
