import { and, desc, eq, ne } from 'drizzle-orm';
import { DEFAULTS } from '@/lib/config';
import { getDb } from '@/lib/db';
import { fssaiApplications, listings, sellerProfiles } from '@/lib/db/schema';
import { sellerIsSubscribed } from '@/lib/subscriptions/queries';
import { kitchenGate, paymentDetailsOk } from './gate';

export type ChecklistItem = { key: string; label: string; done: boolean; href: string; hint?: string };

/**
 * Seller onboarding checklist (shown on /seller):
 *   profile + 3 photos → payment details → FSSAI → first dish → subscription
 *   → submit listing request → admin approval → live
 */
export async function kitchenChecklist(sellerId: number) {
  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  if (!profile) return null;
  const [application] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, sellerId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const dishes = await db.select({ id: listings.id }).from(listings).where(and(eq(listings.sellerId, sellerId), ne(listings.moderationStatus, 'rejected')));
  const subscribed = await sellerIsSubscribed(sellerId);
  const gate = await kitchenGate(sellerId);

  const photos = profile.kitchenPhotosJson?.length ?? 0;
  const fssaiStarted = profile.fssaiStatus === 'verified' || profile.fssaiStatus === 'awaiting_admin_check' || ['filed_on_foscos', 'granted'].includes(application?.status ?? '');
  const state = profile.listingState;
  const items: ChecklistItem[] = [
    { key: 'profile', label: `Kitchen profile + ${DEFAULTS.minKitchenPhotosRequired} photos`, done: !!profile.kitchenName && photos >= DEFAULTS.minKitchenPhotosRequired, href: '/seller/onboarding', hint: `${photos}/${DEFAULTS.minKitchenPhotosRequired} photos` },
    { key: 'payment', label: 'Payment details (UPI ID or pay-at-pickup)', done: paymentDetailsOk(profile), href: '/seller/payment-details' },
    { key: 'fssai', label: 'FSSAI registration', done: fssaiStarted, href: '/seller/compliance' },
    { key: 'dish', label: 'Add your first dish', done: dishes.length > 0, href: '/seller/listings' },
    { key: 'subscription', label: 'Choose and pay a subscription plan', done: subscribed, href: '/seller/subscription' },
    { key: 'submit', label: 'Submit your listing request', done: ['submitted', 'approved', 'delisted'].includes(state), href: '/seller' },
    { key: 'approval', label: 'PadosiPlate approval', done: state === 'approved', href: '/seller/inbox', hint: state === 'changes_requested' ? 'Changes requested — see inbox' : state === 'rejected' ? 'Not approved' : state === 'delisted' ? 'Delisted' : undefined },
    { key: 'live', label: 'Live to your neighbours', done: gate.ok, href: '/seller' },
  ];
  const requestReady = items.slice(0, 5).every((i) => i.done);
  return { items, requestReady, state, reviewNote: profile.listingReviewNote, gate };
}
