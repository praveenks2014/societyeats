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
    .values({ phone: `98${String(10000000 + i).padStart(8, '0')}`, email: `u${i}@t.example`, emailVerifiedAt: new Date(), name: `User ${i}`, passwordHash: 'x', role, lat: 17.465, lng: 78.31, ...over })
    .returning();
  return u;
}

/** A fully-live kitchen: approved, subscribed, FSSAI-verified, UPI on file, one approved dish. */
export async function makeLiveKitchen(db: Db, opts: { societyId?: number; price?: number; qty?: number; upi?: boolean; payAtPickup?: boolean } = {}) {
  const seller = await makeUser(db, 'seller', { societyId: opts.societyId ?? null });
  await db.insert(schema.sellerProfiles).values({
    userId: seller.id,
    kitchenName: `Kitchen ${seller.id}`,
    isApproved: true,
    listingState: 'approved',
    fssaiStatus: 'verified',
    upiVpa: opts.upi === false ? null : `kitchen${seller.id}@okbank`,
    upiName: `Kitchen ${seller.id}`,
    acceptsUpiNow: opts.upi !== false,
    acceptsPayAtPickup: opts.payAtPickup !== false,
    kitchenPhotosJson: ['/a.jpg', '/b.jpg', '/c.jpg'],
  });
  await db.insert(schema.kitchenSubscriptions).values({ sellerId: seller.id, planNameSnapshot: 'Test', durationMonthsSnapshot: 3, status: 'active', startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 60 * 86_400_000) });
  const [dish] = await db
    .insert(schema.listings)
    .values({ sellerId: seller.id, title: 'Biryani', priceInPaise: opts.price ?? 10000, cuisine: 'Hyderabadi', availableQty: opts.qty ?? 10, isActive: true, moderationStatus: 'approved' })
    .returning();
  return { seller, dish };
}
