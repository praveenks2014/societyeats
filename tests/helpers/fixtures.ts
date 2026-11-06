import * as schema from '@/lib/db/schema';
import type { Db } from '@/lib/db';

let seq = 0;
const n = () => ++seq;

export async function makeSociety(db: Db, over: Partial<typeof schema.societies.$inferInsert> = {}) {
  const [s] = await db
    .insert(schema.societies)
    .values({ name: `Soc ${n()}`, city: 'Hyderabad', lat: 17.465, lng: 78.31, addressText: 'x', inviteCode: `CODE${n()}`, isLive: true, ...over })
    .returning();
  return s;
}

export async function makeUser(db: Db, role: 'buyer' | 'seller' | 'admin' = 'buyer', over: Partial<typeof schema.users.$inferInsert> = {}) {
  const i = n();
  const [u] = await db
    .insert(schema.users)
    .values({ phone: `98${String(10000000 + i).padStart(8, '0')}`, email: `u${i}@t.example`, emailVerifiedAt: new Date(), age18ConfirmedAt: new Date(), name: `User ${i}`, passwordHash: 'x', role, lat: 17.465, lng: 78.31, ...over })
    .returning();
  // Pilot v2: invite-only — a user with a society is an approved member of it.
  if (u.societyId) await db.insert(schema.societyMemberships).values({ userId: u.id, societyId: u.societyId, status: 'approved', tower: 'A', flat: '101' });
  return u;
}

/** A fully-live kitchen: approved, subscribed, FSSAI-verified, UPI on file, one approved dish. */
export async function makeLiveKitchen(db: Db, opts: { societyId?: number; price?: number; qty?: number; upiVerified?: boolean; acceptsCash?: boolean; fssai?: 'verified' | 'provisional' } = {}) {
  const seller = await makeUser(db, 'seller', { societyId: opts.societyId ?? null });
  await db.insert(schema.sellerProfiles).values({
    userId: seller.id,
    kitchenName: `Kitchen ${seller.id}`,
    isApproved: true,
    listingState: 'approved',
    fssaiStatus: opts.fssai === 'provisional' ? 'awaiting_admin_check' : 'verified',
    provisionalStartedAt: opts.fssai === 'provisional' ? new Date() : null,
    upiVpa: `kitchen${seller.id}@okbank`,
    upiName: `Kitchen ${seller.id}`,
    upiVerifyStatus: opts.upiVerified === false ? 'unverified' : 'verified',
    upiVerifiedVpa: opts.upiVerified === false ? null : `kitchen${seller.id}@okbank`,
    upiVerifiedName: opts.upiVerified === false ? null : `KITCHEN ${seller.id} COOK`,
    upiVerifiedAt: opts.upiVerified === false ? null : new Date(),
    acceptsCash: opts.acceptsCash ?? false,
    maxOrdersPerSlot: 100,
    maxOrdersPerDay: 100,
    kitchenPhotosJson: ['/a.jpg', '/b.jpg', '/c.jpg'],
  });
  await db.insert(schema.kitchenSubscriptions).values({ sellerId: seller.id, planNameSnapshot: 'Test', durationMonthsSnapshot: 3, status: 'active', startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 60 * 86_400_000) });
  const [dish] = await db
    .insert(schema.listings)
    .values({ sellerId: seller.id, title: 'Biryani', priceInPaise: opts.price ?? 10000, cuisine: 'Hyderabadi', availableQty: opts.qty ?? 10, isActive: true, moderationStatus: 'approved' })
    .returning();
  return { seller, dish };
}

/** A fixed ₹299 / 3-month plan so money assertions do not depend on the seeded catalogue. */
export async function getTestPlan(db: Db) {
  const existing = await db.select().from(schema.subscriptionPlans);
  const found = existing.find((p) => p.name === 'Test 3 months');
  if (found) return found;
  const [p] = await db.insert(schema.subscriptionPlans).values({ name: 'Test 3 months', durationMonths: 3, pricePaise: 29900, active: true, sort: 99 }).returning();
  return p;
}
