import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { hashPassword } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { AGREEMENT_VERSION, HYGIENE_ITEMS } from '@/lib/kitchen/onboarding';
import { fssaiApplications, kitchenSubscriptions, listings, sellerProfiles, societies, societyMemberships, users } from '@/lib/db/schema';
import { referralCodeFor } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

/**
 * E2E ONLY (NODE_ENV!=='production' AND E2E=true): creates a fully onboarded, approved kitchen with a verified UPI ID,
 * a subscription and one approved dish, so scenarios that are not about onboarding do not have to click through it.
 */
export const POST = api(async (req) => {
  if (process.env.NODE_ENV === 'production' || process.env.E2E !== 'true') throw new ApiError(404, 'Not found');
  const b = await readJson<{ n: number; societyId?: number; fssai?: 'verified' | 'provisional'; price?: number; qty?: number; cash?: boolean }>(req);
  const db = await getDb();
  const [soc] = b.societyId ? [{ id: b.societyId }] : await db.select({ id: societies.id }).from(societies).where(eq(societies.inviteCode, 'E2E-ONE'));
  b.societyId = soc.id;
  const phone = `91${String(10000000 + b.n).padStart(8, '0')}`;
  const [u] = await db.insert(users).values({ phone, email: `kitchen${b.n}@e2e.example`, emailVerifiedAt: new Date(), age18ConfirmedAt: new Date(), name: `Cook ${b.n}`, passwordHash: await hashPassword('Sturdy-pass-42'), role: 'seller', societyId: b.societyId!, lat: 17.465, lng: 78.31 }).returning();
  await db.update(users).set({ referralCode: referralCodeFor(u.id) }).where(eq(users.id, u.id));
  await db.insert(societyMemberships).values({ userId: u.id, societyId: b.societyId!, status: 'approved', tower: 'K', flat: String(b.n) });
  const prov = b.fssai === 'provisional';
  await db.insert(sellerProfiles).values({
    userId: u.id, kitchenName: `E2E Kitchen ${b.n}`, legalName: `Cook ${b.n}`, displayName: `Cook ${b.n}`, isApproved: true, listingState: 'approved',
    fssaiStatus: prov ? 'awaiting_admin_check' : 'verified', provisionalStartedAt: prov ? new Date() : null, fssaiNumber: '12345678901234', fssaiCertificateUrl: '/api/files/e2e-cert', fssaiVerifiedBy: prov ? null : 'admin',
    upiVpa: `kitchen${b.n}@okbank`, upiVerifyStatus: 'verified', upiVerifiedVpa: `kitchen${b.n}@okbank`, upiVerifiedName: `COOK ${b.n}`, upiVerifiedAt: new Date(),
    acceptsCash: !!b.cash, offersSelfPickup: true, offersSellerDelivery: true, maxOrdersPerSlot: 100, maxOrdersPerDay: 100,
    kitchenPhotosJson: ['/a.jpg', '/b.jpg'], cuisinesJson: ['Biryani'], cookingDaysJson: ['mon'], panMasked: 'ABCDE****F', panNameOnCard: `Cook ${b.n}`,
    hygieneDeclarationJson: Object.fromEntries(HYGIENE_ITEMS.map((i) => [i.key, new Date().toISOString()])), agreementVersion: AGREEMENT_VERSION, agreementAcceptedAt: new Date(),
  });
  await db.insert(kitchenSubscriptions).values({ sellerId: u.id, planNameSnapshot: 'E2E', durationMonthsSnapshot: 3, status: 'waived', startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 80 * 86_400_000) });
  const [dish] = await db.insert(listings).values({ sellerId: u.id, title: `E2E Dish ${b.n}`, priceInPaise: b.price ?? 10000, cuisine: 'Biryani', availableQty: b.qty ?? 50, isActive: true, moderationStatus: 'approved', foodMark: 'veg', isVeg: true, allergensDeclared: true, allergensJson: [] }).returning();
  if (prov) await db.insert(fssaiApplications).values({ sellerId: u.id, applicantName: `Cook ${b.n}`, kitchenAddress: 'x', status: 'filed_on_foscos', foscosRefNumber: `REF${b.n}`, filedAt: new Date(Date.now() - 9 * 86_400_000) });
  return ok({ sellerId: u.id, email: u.email, dishId: dish.id, kitchenName: `E2E Kitchen ${b.n}` });
});
