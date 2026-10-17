import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles, users } from '@/lib/db/schema';
import { isFssaiEligibleToPublish } from '@/lib/fssai/gate';
import { sellerIsSubscribed } from '@/lib/subscriptions/queries';

/** A UPI VPA looks like name@bank (letters, digits, . _ -). */
export const VPA_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/;

export type GateResult = {
  ok: boolean;
  checks: { approved: boolean; subscribed: boolean; fssai: boolean; paymentDetails: boolean; notBlocked: boolean };
  /** Human-readable reasons for the checks that failed. */
  reasons: string[];
};

type ProfileLike = Pick<typeof sellerProfiles.$inferSelect, 'listingState' | 'fssaiStatus' | 'fssaiExpiry' | 'upiVpa' | 'acceptsUpiNow' | 'acceptsPayAtPickup'>;

/** A VPA is required unless pay-at-pickup is the only mode the kitchen offers. */
export function paymentDetailsOk(p: Pick<ProfileLike, 'upiVpa' | 'acceptsUpiNow' | 'acceptsPayAtPickup'>): boolean {
  const upiOk = !!p.upiVpa && VPA_RE.test(p.upiVpa);
  if (p.acceptsUpiNow && !upiOk) return false;
  return p.acceptsUpiNow || p.acceptsPayAtPickup;
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
}): GateResult {
  const checks = {
    approved: input.profile.listingState === 'approved',
    subscribed: input.subscribed,
    fssai: isFssaiEligibleToPublish(input.profile, input.application, input.now),
    paymentDetails: paymentDetailsOk(input.profile),
    notBlocked: !input.userBlocked,
  };
  const reasons: string[] = [];
  if (!checks.approved) reasons.push('Kitchen is not approved by PadosiPlate');
  if (!checks.subscribed) reasons.push('Kitchen subscription is not active');
  if (!checks.fssai) reasons.push('FSSAI requirement not met');
  if (!checks.paymentDetails) reasons.push('Payment details missing (UPI ID or pay-at-pickup)');
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
  if (!row) return { ok: false, checks: { approved: false, subscribed: false, fssai: false, paymentDetails: false, notBlocked: false }, reasons: ['Kitchen not found'], profile: null };
  const [application] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, sellerId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const subscribed = await sellerIsSubscribed(sellerId, now);
  const result = evaluateGate({ profile: row.profile, application: application ?? null, subscribed, userBlocked: !!row.blockedAt, now });
  return { ...result, profile: row.profile };
}
