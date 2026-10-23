import { DEMO_ADMIN_EMAIL } from '@/lib/auth/admins';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './index';
// Safe to import directly (unlike getPlatformSettings/getDb): config.ts has
// no imports of its own, so this can't introduce the module-init cycle the
// referralCode() comment below is careful to avoid.
import { DEFAULTS } from '@/lib/config';
import {
  complaints,
  deliveries,
  fssaiApplications,
  listings,
  malls,
  notifications,
  orderEvents,
  orderItems,
  orders,
  payments,
  platformConfig,
  providerHealth,
  referralCredits,
  restaurantItems,
  restaurants,
  reviews,
  sellerProfiles,
  societies,
  subscriptions,
  users,
} from './schema';

// Mirrors src/lib/referrals.ts's referralCodeFor() exactly — duplicated as a
// trivial pure one-liner rather than imported, so this seed module (which
// db/index.ts dynamically imports from *inside* getDb()'s own init path)
// never has to load that file's getDb()/getPlatformSettings() imports —
// avoids any risk of a module-init cycle through db/index.ts.
const referralCode = (userId: number) => `GS${userId.toString(36).toUpperCase()}`;

/**
 * Hyderabad demo universe. Demo password for every account: demo1234
 *   buyer      9999999901   seller  9999999902
 *   restaurant 9999999903   admin   9999999904
 */

const img = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=800&q=70`;

export async function seedIfEmpty(db: Db): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return;
  await runSeed(db);
}

export async function runSeed(db: Db): Promise<void> {
  // Demo data includes accounts with a well-known password (demo1234). It must
  // never reach a production database by accident.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to seed demo data when NODE_ENV=production (set ALLOW_DEMO_SEED=true to override).');
  }
  console.log('Seeding PadosiPlate demo data (Hyderabad)…');
  const hash = bcrypt.hashSync('demo1234', 10);

  // ---- societies (~8.9 km apart) ----
  // Pilot Hardening v2 — Phase 6 (Society-first launch mechanics,
  // DECISIONS.md #87+): the pilot is one live, publicly-joinable society
  // (Aparna Cyberzon) — new signups pick it from the register form's
  // dropdown. My Home Avatar demonstrates the invite-code path: not yet
  // public (isLive: false), but still onboardable ahead of general
  // availability via a code shared directly (e.g. a phased building-by-
  // building rollout), so both signup paths have a real seeded case.
  const [cyberzon, avatar] = await db
    .insert(societies)
    .values([
      {
        name: 'Aparna Cyberzon',
        city: 'Hyderabad',
        lat: 17.465,
        lng: 78.31,
        addressText: 'Aparna Cyberzon, Nallagandla, Hyderabad 500019',
        inviteCode: 'CYBERZON',
        isLive: true,
        // Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md
        // #99+): ~300 of the society's 200-500 households targeted for the
        // pilot — see the 8-week pilot-history block below, which grows
        // registration toward this.
        targetHouseholds: 300,
      },
      {
        name: 'My Home Avatar',
        city: 'Hyderabad',
        lat: 17.396,
        lng: 78.352,
        addressText: 'My Home Avatar, Narsingi, Hyderabad 500075',
        inviteCode: 'AVATAR-EARLY',
        isLive: false,
        // Not yet launched — no target set beyond the schema default, and
        // deliberately given no 8-week pilot-history data (see below): a
        // near-empty /admin/metrics view for a not-yet-live society is itself
        // a realistic state to demo, not a gap to fill.
        targetHouseholds: 150,
      },
    ])
    .returning();

  // ---- users ----
  const mkUser = (
    phone: string,
    name: string,
    role: 'buyer' | 'seller' | 'restaurant' | 'admin',
    societyId: number | null,
    lat: number,
    lng: number,
  ) => ({
    phone,
    name,
    passwordHash: hash,
    role,
    societyId,
    lat,
    lng,
    // Demo accounts get verified demo emails; the demo admin's is allowlisted in non-production only.
    email: phone === '9999999904' ? DEMO_ADMIN_EMAIL : `u${phone}@demo.padosiplate.example`,
    emailVerifiedAt: new Date(),
  });

  const [
    buyer,
    seller1,
    restMgr1,
    admin,
    seller2,
    seller3,
    seller4,
    seller5,
    seller6,
    restMgr2,
    restMgr3,
    buyer2,
  ] = await db
    .insert(users)
    .values([
      mkUser('9999999901', 'Priya Sharma', 'buyer', cyberzon.id, 17.4653, 78.3105),
      mkUser('9999999902', 'Lakshmi Devi', 'seller', cyberzon.id, 17.4648, 78.3097),
      mkUser('9999999903', 'Arjun Reddy', 'restaurant', null, 17.4188, 78.4485),
      mkUser('9999999904', 'Admin', 'admin', null, 17.44, 78.35),
      mkUser('9999999905', 'Subbalakshmi Iyer', 'seller', cyberzon.id, 17.4655, 78.3102),
      mkUser('9999999906', 'Anindita Sen', 'seller', cyberzon.id, 17.4645, 78.3095),
      mkUser('9999999907', 'Kavita Jain', 'seller', avatar.id, 17.3962, 78.3518),
      mkUser('9999999908', 'Ritu Malhotra', 'seller', avatar.id, 17.3958, 78.3523),
      mkUser('9999999909', 'Harpreet Kaur', 'seller', avatar.id, 17.3963, 78.3525),
      mkUser('9999999910', 'Wei Chen', 'restaurant', null, 17.4188, 78.4485),
      mkUser('9999999911', 'Ramesh Gupta', 'restaurant', null, 17.4188, 78.4485),
      mkUser('9999999912', 'Aditya Rao', 'buyer', avatar.id, 17.3961, 78.3521),
    ])
    .returning();

  // Every account gets a referral code (Pilot Hardening v2 — Phase 6,
  // DECISIONS.md #87+) — set in a follow-up UPDATE since it's derived from
  // the now-known id, exactly matching POST /api/auth/register's own
  // insert-then-update sequence. buyer2 is seeded as already referred by
  // buyer (with a pre-granted credit below) so /refer has a real demo case
  // out of the box.
  const allUsers = [buyer, seller1, restMgr1, admin, seller2, seller3, seller4, seller5, seller6, restMgr2, restMgr3, buyer2];
  for (const u of allUsers) {
    await db.update(users).set({ referralCode: referralCode(u.id) }).where(eq(users.id, u.id));
  }
  await db.update(users).set({ referredByUserId: buyer.id }).where(eq(users.id, buyer2.id));

  // ---- seller profiles ----
  const in2027 = '2027-06-30';
  await db.insert(sellerProfiles).values([
    {
      userId: seller1.id,
      kitchenName: "Ammama's Biryani Ghar",
      bio: 'Third-generation Hyderabadi dum biryani, cooked in small batches on charcoal.',
      fssaiNumber: '23625011000101',
      fssaiStatus: 'verified',
      fssaiExpiry: in2027,
      isApproved: true,
      vegOnly: false,
      rating: 4.8,
      ratingCount: 132,
      payoutVpaOrBank: 'lakshmi@upi',
      offersSelfPickup: true,
      offersSellerDelivery: true,
      sellerDeliveryFeeInPaise: 3000,
      sellerDeliveryRadiusKm: 4,
      pickupInstructions: 'Tower B, Flat 1204, Aparna Cyberzon — collect between 12:30–1:30 or 7:30–8:30',
      maxOrdersPerSlot: 8,
      kitchenPhotosJson: [img('1556910103-1c02745aae4d'), img('1600628421066-f6bda6a7b797'), img('1585937421612-70a008356fbe')],
      cookingSinceYear: 2015,
      cuisinesJson: ['Biryani', 'Desserts'],
    },
    {
      userId: seller2.id,
      kitchenName: 'Subbalakshmi Tiffins',
      bio: 'Soft idlis, crisp dosas and podi like your Andhra grandmother made.',
      fssaiNumber: '23625011000102',
      fssaiStatus: 'verified',
      fssaiExpiry: in2027,
      isApproved: true,
      vegOnly: true,
      rating: 4.6,
      ratingCount: 98,
      payoutVpaOrBank: 'subbalakshmi@upi',
      offersSelfPickup: true,
      offersSellerDelivery: false,
      pickupInstructions: 'Tower A, Flat 802, Aparna Cyberzon — collect between 7:30–9:00am',
      maxOrdersPerSlot: 6,
      kitchenPhotosJson: [img('1589301760014-d929f3979dbc'), img('1630409351241-e90e7f397dbf'), img('1668236543090-82eba5ee5976')],
      cookingSinceYear: 2019,
      cuisinesJson: ['Tiffins'],
    },
    {
      userId: seller3.id,
      kitchenName: 'Mishti Ghor',
      bio: 'Authentic Bengali sweets — rosogolla, sandesh and nolen gur specials.',
      // FSSAI hardening v3 (DECISIONS.md #119+): demonstrates item 2 (the
      // "enter it anytime" card) AND item 4 (the regulatory publishing
      // gate) at once, on a kitchen that ALSO has a filed application —
      // exactly the "including while an application is pending" case the
      // spec calls out. fssaiNumber/fssaiCertificateUrl/fssaiLicenseeName
      // below mirror what POST /api/fssai/verify would have set on a real
      // submission whose API-returned name didn't fuzzy-match the seller —
      // deliberately a name mismatch, so this is a real, out-of-the-box
      // case for the /admin/fssai "Verify licenses" queue.
      fssaiStatus: 'awaiting_admin_check',
      fssaiNumber: '23625019991234',
      fssaiExpiry: '2027-06-30',
      fssaiCertificateUrl: '/placeholder-doc.svg',
      fssaiLicenseeName: 'Ramesh Gupta',
      fssaiLicenseeAddress: null,
      fssaiVerificationTimelineJson: [
        {
          at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          event: 'License 23625019991234 entered — API found "Ramesh Gupta", queued for admin check (name didn’t auto-match)',
        },
      ],
      isApproved: true,
      vegOnly: true,
      rating: 4.4,
      ratingCount: 41,
      payoutVpaOrBank: 'anindita@upi',
      offersSelfPickup: true,
      pickupInstructions: 'Tower C, Flat 501, Aparna Cyberzon',
      kitchenPhotosJson: [img('1601303516534-bf0b1eb70d2c'), img('1606313564200-e75d5e30476c'), img('1571877227200-a0d98ea607e9')],
      cookingSinceYear: 2021,
      cuisinesJson: ['Bengali Sweets'],
    },
    {
      userId: seller4.id,
      kitchenName: 'Jain Rasoi by Kavita',
      bio: 'Pure Jain cooking — no onion, no garlic, no root vegetables. Sattvik and fresh.',
      fssaiNumber: '23625011000104',
      fssaiStatus: 'verified',
      fssaiExpiry: in2027,
      isApproved: true,
      vegOnly: true,
      rating: 4.7,
      ratingCount: 76,
      payoutVpaOrBank: 'kavita@upi',
      offersSelfPickup: true,
      offersSellerDelivery: true,
      sellerDeliveryFeeInPaise: 2500,
      sellerDeliveryRadiusKm: 3,
      pickupInstructions: 'My Home Avatar, Tower 4, Flat 1102, Narsingi',
      kitchenPhotosJson: [img('1565557623262-b51c2513a641'), img('1589302168068-964664d93dc0'), img('1606491956689-2ea866880c84')],
      cookingSinceYear: 2017,
      cuisinesJson: ['Jain Thali'],
    },
    {
      userId: seller5.id,
      kitchenName: 'FitBowl by Ritu',
      bio: 'Macro-counted keto and high-protein bowls for the gym crowd of Narsingi.',
      fssaiStatus: 'pending_application',
      isApproved: true,
      vegOnly: false,
      rating: 4.3,
      ratingCount: 27,
      payoutVpaOrBank: 'ritu@upi',
      offersSelfPickup: true,
      pickupInstructions: 'My Home Avatar, Tower 6, Flat 704, Narsingi',
      kitchenPhotosJson: [img('1512621776951-a57141f2eefd'), img('1546069901-ba9599a7e63c'), img('1540189549336-e6e99c3679fe')],
      cookingSinceYear: 2023,
      cuisinesJson: ['Keto Bowls'],
    },
    {
      userId: seller6.id,
      kitchenName: "Nani's North Indian",
      bio: 'Punjabi comfort food — rajma chawal, parathas with white butter.',
      fssaiStatus: 'unverified',
      isApproved: false,
      vegOnly: true,
      rating: 0,
      ratingCount: 0,
      payoutVpaOrBank: 'harpreet@upi',
      offersSelfPickup: true,
    },
  ]);

  // FSSAI applications for Mishti Ghor (awaiting_admin_check — see its
  // profile above) and FitBowl (pending_application)
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  await db.insert(fssaiApplications).values([
    {
      sellerId: seller3.id,
      applicantName: 'Anindita Sen',
      kitchenAddress: 'Flat 1204, Aparna Cyberzon, Nallagandla, Hyderabad 500019',
      licenseType: 'state',
      documentsJson: [
        { label: 'Photo ID (Aadhaar)', url: '/placeholder-doc.svg' },
        { label: 'Address proof', url: '/placeholder-doc.svg' },
        { label: 'Kitchen photo', url: '/placeholder-doc.svg' },
        { label: 'Signed declaration', url: '/placeholder-doc.svg' },
      ],
      status: 'filed_on_foscos',
      foscosRefNumber: 'FOSCOS-TS-2026-118842',
      // FSSAI hardening v3 (DECISIONS.md #119+): 65 days ago — past the
      // 60-day State License deemed-commencement window (src/lib/fssai/
      // gate.ts), so this kitchen's listings are visible in browse with an
      // "FSSAI applied · ref FOSCOS-TS-2026-118842" badge out of the box,
      // demonstrating item 4's regulatory publishing gate and item 5's
      // reminder notification without waiting for real time to pass.
      filedAt: daysAgo(65),
      filingMode: 'facilitator',
      facilitationCostInPaise: 200000,
      sponsoredByPlatform: true,
      timelineJson: [
        { at: daysAgo(65).toISOString(), event: "Application submitted to PadosiPlate's back office" },
        { at: daysAgo(63).toISOString(), event: 'Documents verified by back-office' },
        { at: daysAgo(65).toISOString(), event: 'Filed on FoSCoS — ref FOSCOS-TS-2026-118842' },
      ],
      createdAt: daysAgo(65),
      updatedAt: daysAgo(65),
    },
    {
      sellerId: seller5.id,
      applicantName: 'Ritu Malhotra',
      kitchenAddress: 'Villa 42, My Home Avatar, Narsingi, Hyderabad 500075',
      licenseType: 'state',
      documentsJson: [
        { label: 'Photo ID (Aadhaar)', url: '/placeholder-doc.svg' },
        { label: 'Address proof', url: '/placeholder-doc.svg' },
        { label: 'Kitchen photo', url: '/placeholder-doc.svg' },
        { label: 'Signed declaration', url: '/placeholder-doc.svg' },
      ],
      status: 'submitted_to_backoffice',
      filingMode: 'facilitator',
      facilitationCostInPaise: 200000,
      sponsoredByPlatform: true,
      timelineJson: [
        { at: daysAgo(2).toISOString(), event: "Application submitted to PadosiPlate's back office" },
      ],
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    },
  ]);

  await db.insert(subscriptions).values([
    { sellerId: seller1.id, plan: 'pro', status: 'active', renewsAt: daysAgo(-24) },
    { sellerId: seller2.id, plan: 'free', status: 'active' },
  ]);

  // ---- listings (20 dishes) ----
  const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const L = (
    sellerId: number,
    title: string,
    description: string,
    priceRs: number,
    isVeg: boolean,
    cuisine: string,
    photo: string,
    prepTimeMins: number,
    availableQty: number,
    days: string[] = allDays,
    slots: string[] = ['lunch', 'dinner'],
  ) => ({
    sellerId,
    title,
    description,
    priceInPaise: priceRs * 100,
    isVeg,
    cuisine,
    photoUrl: photo,
    prepTimeMins,
    availableQty,
    slotsJson: { days, slots },
    isActive: true,
  });

  const seeded = await db
    .insert(listings)
    .values([
      // Ammama's Biryani Ghar
      L(seller1.id, 'Hyderabadi Chicken Dum Biryani', 'Slow-cooked on charcoal with saffron, served with mirchi ka salan and raita.', 280, false, 'Biryani', img('1563379091339-03b21ab4a4f8'), 45, 12),
      L(seller1.id, 'Mutton Dum Biryani', 'Sunday special — tender mutton, 3-hour dum. Limited pots.', 420, false, 'Biryani', img('1630383249896-424e482df921'), 60, 6, ['sat', 'sun']),
      L(seller1.id, 'Egg Biryani', 'Boiled eggs tossed in biryani masala over fragrant basmati.', 180, false, 'Biryani', img('1604908176997-125f25cc6f3d'), 35, 10),
      L(seller1.id, 'Double ka Meetha', 'Classic Hyderabadi bread pudding with saffron milk and nuts.', 90, true, 'Desserts', img('1551024506-0bccd828d307'), 20, 15),
      // Subbalakshmi Tiffins
      L(seller2.id, 'Idli with Gunpowder (4 pc)', 'Cloud-soft idlis, ghee gunpowder, coconut and tomato chutneys.', 80, true, 'Tiffins', img('1589301760014-d929f3979dbc'), 20, 24, allDays, ['breakfast']),
      L(seller2.id, 'Pesarattu Upma', 'Green-gram dosa stuffed with rava upma — Andhra classic.', 110, true, 'Tiffins', img('1630409351241-e90e7f397dbf'), 25, 16, allDays, ['breakfast']),
      L(seller2.id, 'Millet Dosa with Peanut Chutney', 'Crisp ragi-jowar dosa, iron-rich and light.', 120, true, 'Tiffins', img('1668236543090-82eba5ee5976'), 25, 14, allDays, ['breakfast', 'dinner']),
      L(seller2.id, 'Curd Rice with Pomegranate', 'Tempered curd rice, pomegranate pearls, curry leaves.', 90, true, 'Tiffins', img('1596797038530-2c107229654b'), 15, 20),
      // Mishti Ghor (FSSAI pending)
      L(seller3.id, 'Kolkata Rosogolla (6 pc)', 'Spongy, syrupy, made fresh every morning with cow milk chhena.', 150, true, 'Bengali Sweets', img('1601303516534-bf0b1eb70d2c'), 30, 10),
      L(seller3.id, 'Nolen Gurer Sandesh (4 pc)', 'Winter special — date-palm jaggery sandesh.', 220, true, 'Bengali Sweets', img('1606313564200-e75d5e30476c'), 30, 8),
      L(seller3.id, 'Mishti Doi (200 g)', 'Caramelised sweet yogurt set in clay pots.', 90, true, 'Bengali Sweets', img('1571877227200-a0d98ea607e9'), 15, 12),
      // Jain Rasoi by Kavita
      L(seller4.id, 'Jain Thali of the Day', 'Two sabzis, dal, phulkas, rice, salad and sweet. No onion, no garlic, no roots.', 220, true, 'Jain Thali', img('1565557623262-b51c2513a641'), 40, 10, weekdays),
      L(seller4.id, 'Sabudana Khichdi with Dry Fruits', 'Fasting-friendly sago khichdi with peanuts and ghee.', 140, true, 'Jain Thali', img('1589302168068-964664d93dc0'), 25, 12),
      L(seller4.id, 'Jain Pav Bhaji', 'Street-style bhaji made without onion, garlic or potato.', 160, true, 'Jain Thali', img('1606491956689-2ea866880c84'), 30, 10),
      // FitBowl by Ritu (FSSAI pending)
      L(seller5.id, 'Keto Paneer Tikka Bowl', 'Char-grilled paneer, sautéed greens, mint dip. 12 g net carbs.', 260, true, 'Keto Bowls', img('1512621776951-a57141f2eefd'), 30, 8),
      L(seller5.id, 'Grilled Chicken Keto Bowl', 'Herb chicken, broccoli, peppers, tahini drizzle. 38 g protein.', 320, false, 'Keto Bowls', img('1546069901-ba9599a7e63c'), 30, 8),
      L(seller5.id, 'Avocado Power Salad', 'Avocado, feta, seeds and cold-pressed olive oil.', 240, true, 'Keto Bowls', img('1540189549336-e6e99c3679fe'), 20, 6),
      // Nani's North Indian (unapproved — hidden from buyers until admin approves)
      L(seller6.id, 'Rajma Chawal', 'Kashmiri rajma slow-simmered overnight, with jeera rice.', 150, true, 'North Indian', img('1585937421612-70a008356fbe'), 35, 10),
      L(seller6.id, 'Aloo Paratha (2 pc)', 'Stuffed parathas with white butter and pickle.', 120, true, 'North Indian', img('1567620905732-2d1ec7ab7445'), 25, 12, allDays, ['breakfast']),
      L(seller6.id, 'Kadhi Pakora with Jeera Rice', 'Tangy besan kadhi, soft pakoras, ghee jeera rice.', 170, true, 'North Indian', img('1631452180519-c014fe946bc7'), 35, 8),
    ])
    .returning();

  // ---- mall mode: GVK One ----
  const [gvk] = await db
    .insert(malls)
    .values([
      { slug: 'gvk-one', name: 'GVK One Mall', city: 'Hyderabad', lat: 17.4188, lng: 78.4485 },
    ])
    .returning();

  const [biryaniJn, wokRoll, chaatBazaar] = await db
    .insert(restaurants)
    .values([
      { mallId: gvk.id, name: 'Biryani Junction', counterNumber: '7', managerUserId: restMgr1.id, fssaiNumber: '13625011000201' },
      { mallId: gvk.id, name: 'Wok & Roll', counterNumber: '12', managerUserId: restMgr2.id, fssaiNumber: '13625011000202' },
      { mallId: gvk.id, name: 'Chaat Bazaar', counterNumber: '4', managerUserId: restMgr3.id, fssaiNumber: '13625011000203' },
    ])
    .returning();

  const R = (
    restaurantId: number,
    title: string,
    priceRs: number,
    isVeg: boolean,
    photo: string,
    stockQty: number,
  ) => ({ restaurantId, title, priceInPaise: priceRs * 100, isVeg, photoUrl: photo, stockQty, isActive: true });

  const mallItems = await db
    .insert(restaurantItems)
    .values([
      R(biryaniJn.id, 'Chicken 65 Biryani', 260, false, img('1563379091339-03b21ab4a4f8'), 20),
      R(biryaniJn.id, 'Veg Biryani', 200, true, img('1642821373181-696a54913e93'), 18),
      R(biryaniJn.id, 'Chicken Fry Piece Biryani', 300, false, img('1630383249896-424e482df921'), 15),
      R(biryaniJn.id, 'Raita & Salan Combo', 60, true, img('1596797038530-2c107229654b'), 30),
      R(biryaniJn.id, 'Apricot Delight', 110, true, img('1551024506-0bccd828d307'), 12),
      R(wokRoll.id, 'Veg Hakka Noodles', 180, true, img('1585032226651-759b368d7246'), 22),
      R(wokRoll.id, 'Chilli Chicken (Dry)', 240, false, img('1525755662778-989d0524087e'), 16),
      R(wokRoll.id, 'Paneer Fried Rice', 200, true, img('1512058564366-18510be2db19'), 18),
      R(wokRoll.id, 'Spring Rolls (4 pc)', 140, true, img('1544025162-d76694265947'), 20),
      R(wokRoll.id, 'Hot Garlic Chicken Rice Bowl', 260, false, img('1504674900247-0877df9cc836'), 14),
      R(chaatBazaar.id, 'Pani Puri (8 pc)', 80, true, img('1601050690597-df0568f70950'), 40),
      R(chaatBazaar.id, 'Dahi Bhalla Chaat', 120, true, img('1589302168068-964664d93dc0'), 25),
      R(chaatBazaar.id, 'Samosa Ragda (2 pc)', 100, true, img('1601050690117-94f5f6fa8bd7'), 30),
      R(chaatBazaar.id, 'Pav Bhaji', 150, true, img('1606491956689-2ea866880c84'), 20),
      R(chaatBazaar.id, 'Kulfi Falooda', 130, true, img('1567188040759-fb8a883dc6d8'), 18),
    ])
    .returning();

  // ---- provider health (priority order: porter → shadowfax → borzo) ----
  await db.insert(providerHealth).values([
    { provider: 'porter', isEnabled: true, priority: 1, failureCount: 0 },
    { provider: 'shadowfax', isEnabled: true, priority: 2, failureCount: 0 },
    { provider: 'borzo', isEnabled: true, priority: 3, failureCount: 0 },
  ]);

  // ---- platform config defaults (admin-editable) ----
  await db.insert(platformConfig).values([
    { key: 'commissionHomePct', value: '12' },
    { key: 'commissionMallPct', value: '6' },
    { key: 'platformFeePaise', value: '0' },
    { key: 'radiusKm', value: '10' },
    { key: 'fssaiSponsorshipCapPerCohort', value: '10' },
    // platformFssaiCentralLicenseNo deliberately left unseeded (empty) — the
    // admin "live orders blocked" banner should be visible out of the box
    // until a real Central License is entered (DECISIONS.md #62+).
    { key: 'referralCreditPaise', value: '3000' },
    { key: 'referralCreditCapPerUser', value: '5' },
    // "Neighbour's kitchen of the week" (DECISIONS.md #87+) — pre-featuring
    // Ammama's Biryani Ghar so the home page's featured slot has a real
    // out-of-the-box demo case rather than only being reachable by an admin
    // action taken after seeding.
    { key: 'featuredSellerId', value: String(seller1.id) },
  ]);

  // ---- historical orders ----
  const buyerAddress = {
    label: 'Home',
    flat: 'B-1204',
    societyName: 'Aparna Cyberzon',
    addressText: 'Aparna Cyberzon, Nallagandla, Hyderabad 500019',
    lat: 17.4653,
    lng: 78.3105,
  };

  const commission = (subtotal: number, pct: number) => Math.round((subtotal * pct) / 100);

  // helper to create one order with items/events/payment
  async function seedOrder(opts: {
    buyerId: number;
    type: 'home_delivery' | 'mall_pickup';
    sellerId?: number;
    restaurantId?: number;
    status: (typeof orders.status.enumValues)[number];
    items: { listingId?: number; restaurantItemId?: number; title: string; qty: number; unitPaise: number }[];
    deliveryFee: number;
    createdDaysAgo: number;
    events: { status: string; note?: string; minutesAfter: number }[];
    paid: boolean;
    commissionPct: number;
    otp: string;
    // Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md
    // #99+). Both optional and additive: every pre-existing call site omits
    // them and gets byte-identical behaviour to before (fulfillmentType
    // falls back to the schema's own 'self_pickup' default; gstPct defaults
    // to 0, so gstInPaise/totalInPaise are unchanged) — only the new 8-week
    // pilot-history orders below pass them, since accurate fulfillment mix
    // and GST-aware totals actually matter for that reporting.
    fulfillmentType?: 'self_pickup' | 'seller_delivery' | 'platform_delivery';
    gstPct?: number;
  }) {
    const subtotal = opts.items.reduce((s, i) => s + i.qty * i.unitPaise, 0);
    const gstInPaise = Math.round((subtotal * (opts.gstPct ?? 0)) / 100);
    const createdAt = daysAgo(opts.createdDaysAgo);
    const [order] = await db
      .insert(orders)
      .values({
        buyerId: opts.buyerId,
        type: opts.type,
        sellerId: opts.sellerId,
        restaurantId: opts.restaurantId,
        status: opts.status,
        fulfillmentType: opts.fulfillmentType ?? 'self_pickup',
        subtotalInPaise: subtotal,
        deliveryFeeInPaise: opts.deliveryFee,
        platformFeeInPaise: 0,
        commissionInPaise: commission(subtotal, opts.commissionPct),
        gstInPaise,
        totalInPaise: subtotal + opts.deliveryFee + gstInPaise,
        deliveryAddressJson: opts.type === 'home_delivery' ? buyerAddress : null,
        otpCode: opts.otp,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    await db.insert(orderItems).values(
      opts.items.map((i) => ({
        orderId: order.id,
        listingId: i.listingId,
        restaurantItemId: i.restaurantItemId,
        titleSnapshot: i.title,
        qty: i.qty,
        unitPriceInPaise: i.unitPaise,
      })),
    );
    await db.insert(orderEvents).values(
      opts.events.map((e) => ({
        orderId: order.id,
        status: e.status,
        note: e.note,
        createdAt: new Date(createdAt.getTime() + e.minutesAfter * 60 * 1000),
      })),
    );
    if (opts.paid) {
      await db.insert(payments).values({
        orderId: order.id,
        razorpayOrderId: `order_MOCK${order.id}${Date.now() % 100000}`,
        razorpayPaymentId: `pay_MOCK${order.id}${Date.now() % 100000}`,
        status: 'captured',
        method: 'upi',
        capturedAt: new Date(createdAt.getTime() + 2 * 60 * 1000),
        createdAt,
      });
    }
    return order;
  }

  const l = (idx: number) => seeded[idx]; // listings in insert order

  // 1. delivered biryani order (reviewed)
  const o1 = await seedOrder({
    buyerId: buyer.id,
    type: 'home_delivery',
    sellerId: seller1.id,
    status: 'delivered',
    items: [
      { listingId: l(0).id, title: l(0).title, qty: 2, unitPaise: l(0).priceInPaise },
      { listingId: l(3).id, title: l(3).title, qty: 1, unitPaise: l(3).priceInPaise },
    ],
    deliveryFee: 4200,
    createdDaysAgo: 6,
    paid: true,
    commissionPct: 12,
    otp: '4821',
    events: [
      { status: 'placed', minutesAfter: 0 },
      { status: 'paid', note: 'Payment captured (UPI)', minutesAfter: 2 },
      { status: 'accepted', note: "Ammama's Biryani Ghar accepted", minutesAfter: 6 },
      { status: 'preparing', minutesAfter: 10 },
      { status: 'ready', minutesAfter: 48 },
      { status: 'out_for_delivery', note: 'Rider Srinivas picked up', minutesAfter: 55 },
      { status: 'delivered', note: 'OTP verified by rider', minutesAfter: 82 },
    ],
  });
  await db.insert(deliveries).values({
    orderId: o1.id,
    provider: 'porter',
    providerOrderId: 'PRT-DEMO-88121',
    status: 'delivered',
    riderName: 'Srinivas K',
    riderPhone: '9888800011',
    quoteInPaise: 4200,
    attemptsJson: [
      { provider: 'porter', at: daysAgo(6).toISOString(), outcome: 'success' },
    ],
    dispatchedAt: daysAgo(6),
    createdAt: daysAgo(6),
  });
  await db.insert(reviews).values({
    orderId: o1.id,
    buyerId: buyer.id,
    rating: 5,
    text: 'The dum biryani tasted exactly like my grandmother’s. Rice was perfect!',
    createdAt: daysAgo(5),
    // Demo of the seller-reply feature (DECISIONS.md #73+) — one reply per review.
    sellerReplyText: 'Thank you so much! See you again next weekend 🙏',
    sellerRepliedAt: daysAgo(4),
  });

  // 2. delivered tiffin order (reviewed) — failover demo in history
  const o2 = await seedOrder({
    buyerId: buyer.id,
    type: 'home_delivery',
    sellerId: seller2.id,
    status: 'delivered',
    items: [
      { listingId: l(4).id, title: l(4).title, qty: 3, unitPaise: l(4).priceInPaise },
      { listingId: l(7).id, title: l(7).title, qty: 1, unitPaise: l(7).priceInPaise },
    ],
    deliveryFee: 3500,
    createdDaysAgo: 3,
    paid: true,
    commissionPct: 12,
    otp: '7310',
    events: [
      { status: 'placed', minutesAfter: 0 },
      { status: 'paid', note: 'Payment captured (card)', minutesAfter: 1 },
      { status: 'accepted', minutesAfter: 4 },
      { status: 'preparing', minutesAfter: 8 },
      { status: 'ready', minutesAfter: 25 },
      { status: 'out_for_delivery', note: 'Porter failed twice, failover to Shadowfax', minutesAfter: 33 },
      { status: 'delivered', minutesAfter: 58 },
    ],
  });
  await db.insert(deliveries).values({
    orderId: o2.id,
    provider: 'shadowfax',
    providerOrderId: 'SFX-DEMO-42077',
    status: 'delivered',
    riderName: 'Mohammed A',
    riderPhone: '9888800022',
    quoteInPaise: 3500,
    attemptsJson: [
      { provider: 'porter', at: daysAgo(3).toISOString(), outcome: 'failed', detail: 'No riders available' },
      { provider: 'shadowfax', at: daysAgo(3).toISOString(), outcome: 'success' },
    ],
    dispatchedAt: daysAgo(3),
    createdAt: daysAgo(3),
  });
  await db.insert(reviews).values({
    orderId: o2.id,
    buyerId: buyer.id,
    rating: 4,
    text: 'Idlis were incredibly soft. Delivery took a little longer than promised.',
    createdAt: daysAgo(2),
  });
  // Demo complaint (DECISIONS.md #73+) — populates /admin/complaints out of
  // the box. Seeded directly (bypassing the 24h buyer-facing window check,
  // which only applies to the create API) so the admin queue isn't empty on
  // a fresh demo.
  await db.insert(complaints).values({
    orderId: o2.id,
    buyerId: buyer.id,
    sellerId: seller2.id,
    category: 'wrong_item',
    description: 'Got curd rice instead of the pesarattu upma I ordered.',
    createdAt: daysAgo(2),
  });

  // 3. live order: out_for_delivery from Jain Rasoi
  const o3 = await seedOrder({
    buyerId: buyer.id,
    type: 'home_delivery',
    sellerId: seller4.id,
    status: 'out_for_delivery',
    items: [{ listingId: l(11).id, title: l(11).title, qty: 2, unitPaise: l(11).priceInPaise }],
    deliveryFee: 5600,
    createdDaysAgo: 0,
    paid: true,
    commissionPct: 12,
    otp: '2196',
    events: [
      { status: 'placed', minutesAfter: 0 },
      { status: 'paid', minutesAfter: 1 },
      { status: 'accepted', minutesAfter: 3 },
      { status: 'preparing', minutesAfter: 6 },
      { status: 'ready', minutesAfter: 35 },
      { status: 'out_for_delivery', note: 'Rider Venkat picked up', minutesAfter: 41 },
    ],
  });
  await db.insert(deliveries).values({
    orderId: o3.id,
    provider: 'porter',
    providerOrderId: 'PRT-DEMO-90455',
    status: 'in_transit',
    riderName: 'Venkat R',
    riderPhone: '9888800033',
    quoteInPaise: 5600,
    attemptsJson: [{ provider: 'porter', at: new Date().toISOString(), outcome: 'success' }],
    dispatchedAt: new Date(Date.now() - 6 * 60 * 1000),
    createdAt: new Date(Date.now() - 6 * 60 * 1000),
  });

  // 4. preparing keto order
  const o4 = await seedOrder({
    buyerId: buyer2.id,
    type: 'home_delivery',
    sellerId: seller5.id,
    status: 'preparing',
    items: [
      { listingId: l(14).id, title: l(14).title, qty: 1, unitPaise: l(14).priceInPaise },
      { listingId: l(16).id, title: l(16).title, qty: 1, unitPaise: l(16).priceInPaise },
    ],
    deliveryFee: 3900,
    createdDaysAgo: 0,
    paid: true,
    commissionPct: 12,
    otp: '5544',
    events: [
      { status: 'placed', minutesAfter: 0 },
      { status: 'paid', minutesAfter: 1 },
      { status: 'accepted', minutesAfter: 5 },
      { status: 'preparing', minutesAfter: 9 },
    ],
  });

  // 5. mall pickup order, ready at counter
  await seedOrder({
    buyerId: buyer.id,
    type: 'mall_pickup',
    restaurantId: biryaniJn.id,
    status: 'ready',
    items: [
      { restaurantItemId: mallItems[0].id, title: mallItems[0].title, qty: 1, unitPaise: mallItems[0].priceInPaise },
      { restaurantItemId: mallItems[3].id, title: mallItems[3].title, qty: 1, unitPaise: mallItems[3].priceInPaise },
    ],
    deliveryFee: 0,
    createdDaysAgo: 0,
    paid: true,
    commissionPct: 6,
    otp: '9902',
    events: [
      { status: 'placed', minutesAfter: 0 },
      { status: 'paid', minutesAfter: 1 },
      { status: 'accepted', note: 'Biryani Junction received', minutesAfter: 2 },
      { status: 'preparing', minutesAfter: 5 },
      { status: 'ready', note: 'Collect at Counter 7', minutesAfter: 14 },
    ],
  });

  // 6. cancelled sweets order
  await seedOrder({
    buyerId: buyer2.id,
    type: 'home_delivery',
    sellerId: seller3.id,
    status: 'cancelled',
    items: [{ listingId: l(8).id, title: l(8).title, qty: 2, unitPaise: l(8).priceInPaise }],
    deliveryFee: 4100,
    createdDaysAgo: 1,
    paid: false,
    commissionPct: 12,
    otp: '1180',
    events: [
      { status: 'placed', minutesAfter: 0 },
      { status: 'cancelled', note: 'Payment not completed within 15 minutes', minutesAfter: 16 },
    ],
  });

  // 7-15. nine more small delivered orders from Ammama's Biryani Ghar, purely
  // so the seller-recognition badge (10 / 50 / 100 completed orders —
  // DECISIONS.md #87+) has a real out-of-the-box demo case: order #1 above
  // is this kitchen's only "hand-authored" order, which alone wouldn't cross
  // the lowest tier. Minimal events (no delivery/review rows) since only
  // orders.status matters for the badge count.
  let extraComplaintOrder: { id: number; buyerId: number } | null = null;
  for (let i = 0; i < 9; i++) {
    const o = await seedOrder({
      buyerId: i % 2 === 0 ? buyer.id : buyer2.id,
      type: 'home_delivery',
      sellerId: seller1.id,
      status: 'delivered',
      items: [{ listingId: l(2).id, title: l(2).title, qty: 1, unitPaise: l(2).priceInPaise }],
      deliveryFee: 3000,
      createdDaysAgo: 10 + i,
      paid: true,
      commissionPct: 12,
      otp: String(3001 + i),
      events: [
        { status: 'placed', minutesAfter: 0 },
        { status: 'delivered', note: 'OTP verified by rider', minutesAfter: 45 },
      ],
    });
    // 4th demo complaint (DECISIONS.md #112+): left OPEN (unresolved), unlike
    // the wrong_item one above and the two resolved ones seeded below, so the
    // admin queue shows all three real-world states (open + resolved x2) out
    // of the box instead of only "already handled" ones.
    if (i === 4) extraComplaintOrder = { id: o.id, buyerId: o.buyerId };
  }
  if (extraComplaintOrder) {
    await db.insert(complaints).values({
      orderId: extraComplaintOrder.id,
      buyerId: extraComplaintOrder.buyerId,
      sellerId: seller1.id,
      category: 'not_received',
      description: 'Order was marked delivered but never arrived — please check with the rider.',
      createdAt: daysAgo(4),
    });
  }

  // Pilot Hardening v2 — Phase 6 (Society-first launch mechanics,
  // DECISIONS.md #87+): buyer2 was referred by buyer (referredByUserId set
  // above) — pre-granting buyer an available ₹30 credit here so /refer and
  // checkout's "apply credit" toggle both have a real demo case out of the
  // box, without needing to walk a referred account through a full delivered
  // order first. `referredOrderId` points at buyer2's real seeded order o4.
  await db.insert(referralCredits).values({
    buyerId: buyer.id,
    referredUserId: buyer2.id,
    referredOrderId: o4.id,
    amountInPaise: 3000,
    status: 'available',
  });

  // welcome notification for the demo buyer
  await db.insert(notifications).values({
    userId: buyer.id,
    title: 'Welcome to PadosiPlate 🎉',
    body: 'Home kitchens within 10 km of you are cooking today. Your order from Jain Rasoi is on the way!',
    href: '/orders',
  });

  // ================================================================
  // Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md
  // #99+). Eight weeks of plausible historical activity for Aparna Cyberzon
  // (the pilot's one live society) so /admin/metrics has real, varied
  // week-over-week numbers out of the box: buyer registration growing
  // toward the household target, growing order volume with a fulfillment
  // mix that shifts from self-pickup-heavy to more seller-delivery over
  // time, a seller who joins then goes quiet (churn demo), one who joins
  // late (growth demo), a cohort of buyers who reorder ~3 weeks after their
  // first order (week-4 retention), and two resolved complaints placed so
  // the refund/complaint-rate metric shows a rough week improving into a
  // healthy one. My Home Avatar (not yet public) deliberately gets none of
  // this — a near-empty metrics view for a not-yet-launched society is
  // itself a realistic state, not a gap.
  //
  // Every date below is expressed the same "days ago from seed time" way as
  // every seedOrder() call above, and every choice (which buyer/seller/item/
  // fulfillment type lands on which order) is picked by deterministic index
  // cycling rather than randomness — a re-seed always reproduces the exact
  // same numbers, matching this codebase's existing zero-flakiness ethos
  // (see DECISIONS.md #32).
  // ================================================================
  const PILOT_WEEKS = 8;
  const weekStartDaysAgo = (w: number) => 7 * (PILOT_WEEKS - w + 1); // "days ago" at week w's start
  const dateInWeek = (w: number, dayOffset: number) => daysAgo(weekStartDaysAgo(w) - dayOffset); // dayOffset 0..6

  // ---- new buyer households, staggered registration across the 8 weeks,
  // growing cumulative penetration toward Cyberzon's 300-household target
  // (108 new + the 2 already seeded above = 110, ~37% by week 8 — an early,
  // still-building pilot, not a finished one). ----
  const NEW_BUYERS_PER_WEEK = [15, 12, 14, 13, 14, 12, 15, 13];
  const pilotBuyerInserts: (typeof users.$inferInsert)[] = [];
  let buyerSeq = 1;
  for (let w = 1; w <= PILOT_WEEKS; w++) {
    for (let i = 0; i < NEW_BUYERS_PER_WEEK[w - 1]; i++) {
      pilotBuyerInserts.push({
        // 9802xxxxxx — distinct from the 9801000xxx range used by the three
        // new seller kitchens below, and from the 99999999xx demo accounts.
        phone: `9802${String(buyerSeq).padStart(6, '0')}`,
        name: `Cyberzon Household ${buyerSeq}`,
        passwordHash: hash,
        role: 'buyer',
        societyId: cyberzon.id,
        lat: 17.465 + ((buyerSeq % 11) - 5) * 0.0006,
        lng: 78.31 + ((buyerSeq % 7) - 3) * 0.0006,
        createdAt: dateInWeek(w, buyerSeq % 7),
      });
      buyerSeq++;
    }
  }
  const insertedPilotBuyers = await db.insert(users).values(pilotBuyerInserts).returning();
  for (const u of insertedPilotBuyers) {
    await db.update(users).set({ referralCode: referralCode(u.id) }).where(eq(users.id, u.id));
  }
  const buyersByWeek: number[][] = [];
  {
    let idx = 0;
    for (let w = 1; w <= PILOT_WEEKS; w++) {
      const count = NEW_BUYERS_PER_WEEK[w - 1];
      buyersByWeek.push(insertedPilotBuyers.slice(idx, idx + count).map((u) => u.id));
      idx += count;
    }
  }

  // ---- three new seller kitchens, staggered join dates: Curry Studio
  // (joins week 2, keeps posting fresh listings throughout — never churns),
  // Sunita's Snack Box (joins week 2, posts once, then goes quiet — churns
  // starting week 4), Farhan's Grill House (joins late, week 7 — growth demo). ----
  const [pilotSeller7, pilotSeller8, pilotSeller9] = await db
    .insert(users)
    .values([
      { phone: '9801000001', name: 'Meera Kulkarni', passwordHash: hash, role: 'seller', societyId: cyberzon.id, lat: 17.4651, lng: 78.3103, createdAt: dateInWeek(2, 2) },
      { phone: '9801000002', name: 'Sunita Rao', passwordHash: hash, role: 'seller', societyId: cyberzon.id, lat: 17.4649, lng: 78.3098, createdAt: dateInWeek(2, 4) },
      { phone: '9801000003', name: 'Farhan Ali', passwordHash: hash, role: 'seller', societyId: cyberzon.id, lat: 17.4652, lng: 78.3101, createdAt: dateInWeek(7, 2) },
    ])
    .returning();
  for (const u of [pilotSeller7, pilotSeller8, pilotSeller9]) {
    await db.update(users).set({ referralCode: referralCode(u.id) }).where(eq(users.id, u.id));
  }

  await db.insert(sellerProfiles).values([
    {
      userId: pilotSeller7.id,
      kitchenName: 'Curry Studio',
      bio: 'Small-batch North Indian curries, cooked to order.',
      fssaiNumber: '23625011000107',
      fssaiStatus: 'verified',
      fssaiExpiry: in2027,
      isApproved: true,
      vegOnly: false,
      rating: 4.5,
      ratingCount: 18,
      payoutVpaOrBank: 'meera@upi',
      offersSelfPickup: true,
      offersSellerDelivery: true,
      sellerDeliveryFeeInPaise: 2000,
      sellerDeliveryRadiusKm: 4,
      pickupInstructions: 'Tower D, Flat 303, Aparna Cyberzon',
    },
    {
      userId: pilotSeller8.id,
      kitchenName: "Sunita's Snack Box",
      bio: 'Evening snacks — cutlets, samosas, bakery bites.',
      fssaiStatus: 'pending_application',
      isApproved: true,
      vegOnly: true,
      rating: 4.1,
      ratingCount: 6,
      payoutVpaOrBank: 'sunita@upi',
      offersSelfPickup: true,
      pickupInstructions: 'Tower A, Flat 405, Aparna Cyberzon',
    },
    {
      userId: pilotSeller9.id,
      kitchenName: "Farhan's Grill House",
      bio: 'Weekend kebabs and grills, small batches.',
      fssaiNumber: '23625011000109',
      fssaiStatus: 'verified',
      fssaiExpiry: in2027,
      isApproved: true,
      vegOnly: false,
      rating: 4.6,
      ratingCount: 9,
      payoutVpaOrBank: 'farhan@upi',
      offersSelfPickup: true,
      pickupInstructions: 'Tower B, Flat 707, Aparna Cyberzon',
    },
  ]);

  // Curry Studio's listings are deliberately spread across the whole 8-week
  // window (createdAt at days-ago 47/35/22/9 — verified so no gap between
  // consecutive dates exceeds the 14-day churn window) so it never shows as
  // churned once eligible (week 2 on). Sunita gets exactly one, dated
  // days-ago 45 — recent enough for weeks 2-3, then stale (>14 days before
  // week 4's end) from week 4 onward, which is the churn demo. Farhan gets
  // one dated days-ago 12, comfortably inside every week's 14-day window
  // from week 7 (when he joins) through week 8.
  const [curry1, curry2, curry3, curry4] = await db
    .insert(listings)
    .values([
      { ...L(pilotSeller7.id, 'Chicken Curry with Rice', 'Home-style chicken curry, steamed rice.', 220, false, 'North Indian', img('1601050690597-df0568f70950'), 35, 10), createdAt: dateInWeek(2, 2) },
      { ...L(pilotSeller7.id, 'Veg Kurma with Chapati', 'Mixed-vegetable kurma, soft chapatis.', 180, true, 'North Indian', img('1585937421612-70a008356fbe'), 30, 10), createdAt: dateInWeek(4, 1) },
      { ...L(pilotSeller7.id, 'Egg Curry Meal', 'Egg curry, rice and a boiled egg on the side.', 200, false, 'North Indian', img('1604908176997-125f25cc6f3d'), 30, 8), createdAt: dateInWeek(5, 6) },
      { ...L(pilotSeller7.id, 'Mutton Curry Rice Bowl', 'Slow-cooked mutton curry over jeera rice.', 260, false, 'North Indian', img('1630383249896-424e482df921'), 40, 6), createdAt: dateInWeek(7, 5) },
    ])
    .returning();
  const [sunita1] = await db
    .insert(listings)
    .values([
      { ...L(pilotSeller8.id, 'Veg Cutlet Box (6 pc)', 'Crisp vegetable cutlets, mint chutney.', 120, true, 'Snacks', img('1601050690117-94f5f6fa8bd7'), 20, 15), createdAt: dateInWeek(2, 4) },
    ])
    .returning();
  const [farhan1] = await db
    .insert(listings)
    .values([
      { ...L(pilotSeller9.id, 'Chicken Seekh Kebab (6 pc)', 'Charcoal-grilled seekh kebabs.', 240, false, 'Grills', img('1525755662778-989d0524087e'), 30, 8), createdAt: dateInWeek(7, 2) },
    ])
    .returning();
  const curryListings = [curry1, curry2, curry3, curry4];

  // ---- weekly order generation ----
  // Sellers scoped to Cyberzon ONLY (seller4/seller5/seller6 are My Home
  // Avatar kitchens, ~8.9 km away — fine for cross-society browse/delivery
  // demos elsewhere in this seed file, but wrong for THIS block: self-pickup
  // specifically means "collect from the seller inside the society," so a
  // Cyberzon household's weekly order history should only ever be fulfilled
  // by kitchens actually registered in Cyberzon).
  type PilotFulfillment = 'self_pickup' | 'seller_delivery' | 'platform_delivery';
  const listingsBySeller: Record<number, { id: number; title: string; priceInPaise: number }[]> = {
    [seller1.id]: [l(0), l(1), l(2), l(3)],
    [seller2.id]: [l(4), l(5), l(6), l(7)],
    [seller3.id]: [l(8), l(9), l(10)],
    [pilotSeller7.id]: curryListings,
    [pilotSeller8.id]: [sunita1],
    [pilotSeller9.id]: [farhan1],
  };
  // Which sellers offer their own delivery (mirrors each seller_profiles row
  // above/earlier) — used to fall back to self-pickup if the fulfillment
  // pattern below would otherwise assign a delivery type a seller doesn't offer.
  const sellerDeliveryOk: Record<number, boolean> = {
    [seller1.id]: true,
    [pilotSeller7.id]: true,
  };
  const sellerDeliveryFee: Record<number, number> = {
    [seller1.id]: 3000,
    [pilotSeller7.id]: 2000,
  };

  const SELLER_ROSTER_BY_WEEK: number[][] = [
    [seller1.id, seller2.id],
    [seller1.id, seller2.id, pilotSeller7.id, pilotSeller8.id],
    [seller1.id, seller2.id, seller3.id, pilotSeller7.id, pilotSeller8.id],
    [seller1.id, seller2.id, seller3.id, pilotSeller7.id], // Sunita has gone quiet
    [seller1.id, seller2.id, seller3.id, pilotSeller7.id],
    [seller1.id, seller2.id, seller3.id, pilotSeller7.id],
    [seller1.id, seller2.id, seller3.id, pilotSeller7.id, pilotSeller9.id],
    [seller1.id, seller2.id, seller3.id, pilotSeller7.id, pilotSeller9.id],
  ];
  // Always exactly 3 entries — deliberately coprime with every week's
  // SELLER_ROSTER_BY_WEEK length (2/4/5) above, so cycling both by the same
  // order index `i` (below) doesn't lock a given seller to one permanent
  // fulfillment type (a same/shared-factor length would: e.g. a 4-long
  // roster against a 4-long pattern pairs each seller with exactly one
  // pattern slot for every single order, so a seller who doesn't offer
  // seller_delivery — falling back to self_pickup — could end up NEVER
  // showing seller_delivery for the whole week, no matter the pattern's
  // intended mix). Coprime lengths mean the (seller, fulfillment) pairing
  // keeps rotating, so the fallback-to-self_pickup logic below only trims a
  // realistic minority rather than an entire category to zero.
  const FULFILLMENT_PATTERN_BY_WEEK: PilotFulfillment[][] = [
    ['self_pickup', 'self_pickup', 'self_pickup'],
    ['self_pickup', 'self_pickup', 'seller_delivery'],
    ['self_pickup', 'self_pickup', 'seller_delivery'],
    ['self_pickup', 'seller_delivery', 'seller_delivery'],
    ['self_pickup', 'seller_delivery', 'seller_delivery'],
    ['self_pickup', 'seller_delivery', 'platform_delivery'],
    ['self_pickup', 'seller_delivery', 'platform_delivery'],
    ['seller_delivery', 'seller_delivery', 'platform_delivery'],
  ];
  const ORDERS_PER_WEEK = [6, 10, 14, 18, 22, 26, 30, 34];
  const FRESH_PER_WEEK = [6, 6, 7, 8, 10, 10, 12, 12];
  // Reorder counts drawn from the fresh cohort exactly 3 weeks earlier — the
  // week-4 buyer-retention signal (index w-1 => cohort week (w-3)).
  const RETENTION_PER_WEEK = [0, 0, 0, 2, 1, 3, 2, 3];

  const freshBuyersByWeek: number[][] = Array.from({ length: PILOT_WEEKS }, () => []);
  const everOrderedPool: number[] = [];
  const weekFirstOrder: Record<number, { id: number; buyerId: number; sellerId: number | null; totalInPaise: number }> = {};
  let pilotOtpSeq = 0;

  for (let w = 1; w <= PILOT_WEEKS; w++) {
    const ordersThisWeek = ORDERS_PER_WEEK[w - 1];
    const freshCount = FRESH_PER_WEEK[w - 1];
    const retentionCount = RETENTION_PER_WEEK[w - 1];
    const roster = SELLER_ROSTER_BY_WEEK[w - 1];
    const pattern = FULFILLMENT_PATTERN_BY_WEEK[w - 1];

    const retentionBuyerIds = retentionCount > 0 ? freshBuyersByWeek[w - 4].slice(0, retentionCount) : [];
    const weekNewBuyerIds = buyersByWeek[w - 1];
    const freshBuyerIds = weekNewBuyerIds.slice(0, freshCount);
    const protectedCount = retentionBuyerIds.length + freshBuyerIds.length;

    const assignments: number[] = [...retentionBuyerIds, ...freshBuyerIds];
    const genericRepeatSlots = ordersThisWeek - assignments.length;
    // The generic repeat draw excludes the ENTIRE cohort this week is
    // measuring week-4 retention for (w >= 4 only) — otherwise the draw,
    // which always starts from the front of the pool, would keep
    // coincidentally re-selecting whichever cohort sits earliest in it
    // (exactly the cohort being measured most weeks), inflating retention
    // far past what RETENTION_PER_WEEK actually intends. This way the ONLY
    // route a cohort member can reappear in their own measured week is the
    // explicit retentionBuyerIds draw above, so retained count is always
    // exactly RETENTION_PER_WEEK[w-1] — deliberate, not incidental.
    const measuredCohort = w >= 4 ? new Set(freshBuyersByWeek[w - 4]) : new Set<number>();
    const drawPool = everOrderedPool.filter((id) => !measuredCohort.has(id));
    for (let i = 0; i < genericRepeatSlots; i++) {
      assignments.push(drawPool[i % drawPool.length]);
    }

    for (let i = 0; i < ordersThisWeek; i++) {
      const buyerId = assignments[i];
      const isFreshOrder = i >= retentionBuyerIds.length && i < protectedCount;
      const sellerId = roster[i % roster.length];
      const sellerListings = listingsBySeller[sellerId];
      const item = sellerListings[i % sellerListings.length];
      const qty = i % 4 === 0 ? 2 : 1;
      const subtotal = qty * item.priceInPaise;

      let fulfillmentType: PilotFulfillment = pattern[i % pattern.length];
      if (fulfillmentType === 'seller_delivery' && !sellerDeliveryOk[sellerId]) fulfillmentType = 'self_pickup';
      if (fulfillmentType === 'platform_delivery' && subtotal < DEFAULTS.platformDeliveryMinOrderPaise) fulfillmentType = 'self_pickup';

      const deliveryFee =
        fulfillmentType === 'seller_delivery'
          ? sellerDeliveryFee[sellerId] ?? 2500
          : fulfillmentType === 'platform_delivery'
            ? 4900
            : 0;

      // Only generic-repeat slots (never a retention/fresh one) can be
      // cancelled — keeps the hand-tuned retention-cohort counts exact.
      const isCancelled = i >= protectedCount && (i - protectedCount) % 15 === 14;
      const terminalStatus = fulfillmentType === 'self_pickup' ? 'picked_up' : 'delivered';
      const status = isCancelled ? 'cancelled' : terminalStatus;
      // 1..6, never 0: dayOffset=0 would land exactly on a week boundary,
      // which real (multi-second) seeding wall-clock drift between this
      // daysAgo() call and metrics.ts's own `now` at query time could tip
      // into the adjacent week's bucket — see DECISIONS.md #99.
      const dayOffset = (i % 6) + 1;

      pilotOtpSeq++;
      const order = await seedOrder({
        buyerId,
        type: 'home_delivery',
        sellerId,
        fulfillmentType,
        gstPct: DEFAULTS.gstPct,
        status,
        items: [{ listingId: item.id, title: item.title, qty, unitPaise: item.priceInPaise }],
        deliveryFee,
        createdDaysAgo: weekStartDaysAgo(w) - dayOffset,
        paid: !isCancelled,
        commissionPct: 12,
        otp: String(6000 + pilotOtpSeq).slice(-4),
        events: isCancelled
          ? [
              { status: 'placed', minutesAfter: 0 },
              { status: 'cancelled', note: 'Payment not completed within 15 minutes', minutesAfter: 15 },
            ]
          : [
              { status: 'placed', minutesAfter: 0 },
              { status: terminalStatus, minutesAfter: 45 },
            ],
      });

      if (!isCancelled) {
        if (isFreshOrder) freshBuyersByWeek[w - 1].push(buyerId);
        if (!everOrderedPool.includes(buyerId)) everOrderedPool.push(buyerId);
        if (i === 0) weekFirstOrder[w] = order;
      }
    }
  }

  // Two resolved complaints with a partial refund each — placed on the
  // FIRST (guaranteed non-cancelled) order of weeks 7 and 8, so the
  // refund/complaint-rate metric shows a rough week (1 of 30 ≈ 3.3%, just
  // over the <3% target) improving into a healthy one (1 of 34 ≈ 2.9%,
  // just under it) rather than a flat, unrealistically perfect 0% throughout.
  async function seedResolvedComplaint(
    order: { id: number; buyerId: number; sellerId: number | null; totalInPaise: number },
    daysAgoResolved: number,
  ) {
    const refundAmount = Math.round(order.totalInPaise * 0.25);
    await db.insert(complaints).values({
      orderId: order.id,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      category: 'quality',
      description: 'A couple of pieces were undercooked.',
      status: 'resolved',
      outcome: 'partial_refund',
      refundInPaise: refundAmount,
      resolutionNote: '25% partial refund issued after review.',
      resolvedByAdminId: admin.id,
      resolvedAt: daysAgo(daysAgoResolved),
      createdAt: daysAgo(daysAgoResolved + 1),
    });
    await db.update(orders).set({ refundInPaise: refundAmount }).where(eq(orders.id, order.id));
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    if (payment) {
      const newRefunded = payment.refundedInPaise + refundAmount;
      await db
        .update(payments)
        .set({ refundedInPaise: newRefunded, status: newRefunded >= order.totalInPaise ? 'refunded' : payment.status })
        .where(eq(payments.orderId, order.id));
    }
  }
  if (weekFirstOrder[7]) await seedResolvedComplaint(weekFirstOrder[7], 8);
  if (weekFirstOrder[8]) await seedResolvedComplaint(weekFirstOrder[8], 1);

  // ================================================================
  // Phase 1 Pilot fix-up: bring the demo universe in line with the new money
  // model (platform fee + kitchen subscription; food paid kitchen-direct).
  // ================================================================
  await db.execute(sql`UPDATE orders SET completed_at = updated_at WHERE status IN ('delivered', 'picked_up') AND completed_at IS NULL`);
  await db.execute(sql`UPDATE orders SET food_total_in_paise = subtotal_in_paise + delivery_fee_in_paise, online_charge_in_paise = total_in_paise WHERE food_total_in_paise = 0`);
  await db.execute(sql`UPDATE orders SET status = 'fee_paid' WHERE status = 'paid' AND type = 'home_delivery'`);
  await db.execute(sql`UPDATE orders SET food_payment_mode = 'pay_at_pickup', food_payment_status = CASE WHEN status IN ('delivered', 'picked_up') THEN 'at_handover' ELSE 'pending' END WHERE type = 'home_delivery' AND food_payment_mode IS NULL`);
  await db.execute(sql`UPDATE payments SET amount_in_paise = COALESCE((SELECT o.total_in_paise FROM orders o WHERE o.id = payments.order_id), 0), kind = 'order_full' WHERE amount_in_paise = 0`);
  await db.execute(sql`UPDATE seller_profiles SET listing_state = 'approved' WHERE is_approved = true`);
  await db.execute(sql`UPDATE seller_profiles SET upi_vpa = payout_vpa_or_bank, upi_name = kitchen_name WHERE payout_vpa_or_bank LIKE '%@%'`);
  // Every demo kitchen has a complimentary running subscription so the feed is populated.
  await db.execute(sql`INSERT INTO kitchen_subscriptions (seller_id, plan_name_snapshot, duration_months_snapshot, status, starts_at, ends_at, notes)
    SELECT user_id, 'Complimentary', 12, 'waived', now() - interval '30 days', now() + interval '11 months', 'Demo data' FROM seller_profiles`);

  console.log(
    'Seed complete: 2 societies (1 live), 9 kitchens, 26 dishes, 1 mall (flagged off), 175 orders (incl. 8 weeks of pilot-metrics history), 4 complaints, 1 referral credit.',
  );
}
