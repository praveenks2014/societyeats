import { and, desc, eq, ne } from 'drizzle-orm';
import { activeMembership } from '@/lib/access';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { fssaiApplications, listings, sellerProfiles } from '@/lib/db/schema';
import { sellerIsSubscribed } from '@/lib/subscriptions/queries';
import { kitchenGate } from './gate';
import { evaluateSteps, type Step } from './onboarding';
import { BRAND } from '@/config/brand';

export type ChecklistItem = Step;

/**
 * Seller onboarding checklist (shown on /seller and on the wizard):
 *   about → kitchen → hygiene → FSSAI → PAN → UPI ₹1 → agreement → first dish (→ plan, when there is no free founding offer)
 *   → submit for admin approval → live
 */
export async function kitchenChecklist(sellerId: number) {
  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  if (!profile) return null;
  const settings = await getPlatformSettings();
  const [application] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, sellerId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const dishes = await db.select({ id: listings.id }).from(listings).where(and(eq(listings.sellerId, sellerId), ne(listings.moderationStatus, 'rejected')));
  const subscribed = await sellerIsSubscribed(sellerId);
  const gate = await kitchenGate(sellerId);
  const membership = await activeMembership(sellerId);

  const fssaiStarted = profile.fssaiStatus === 'verified' || profile.fssaiStatus === 'awaiting_admin_check' || ['filed_on_foscos', 'granted'].includes(application?.status ?? '');
  const state = profile.listingState;
  const steps = evaluateSteps(profile, { isMember: !!membership || !settings.pilotSocietiesOnly, hasDish: dishes.length > 0, planOk: subscribed, fssaiStarted, foundingOffer: settings.foundingKitchenOffer });
  const items: ChecklistItem[] = [
    ...steps,
    { key: 'submit', label: `Submit for ${BRAND.name} approval`, done: ['submitted', 'approved', 'delisted'].includes(state), href: '/seller', hint: state === 'changes_requested' ? 'Changes requested — see inbox' : state === 'rejected' ? 'Not approved' : state === 'delisted' ? 'Delisted' : undefined },
    { key: 'live', label: 'Live to your neighbours', done: gate.ok, href: '/seller' },
  ];
  const requestReady = steps.every((i) => i.done);
  return { items, requestReady, requiredCount: steps.length, state, reviewNote: profile.listingReviewNote, gate };
}
