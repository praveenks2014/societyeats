import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { Db } from './index';
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
  console.log('Seeding GharSe demo data (Hyderabad)…');
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
      },
      {
        name: 'My Home Avatar',
        city: 'Hyderabad',
        lat: 17.396,
        lng: 78.352,
        addressText: 'My Home Avatar, Narsingi, Hyderabad 500075',
        inviteCode: 'AVATAR-EARLY',
        isLive: false,
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
  ) => ({ phone, name, passwordHash: hash, role, societyId, lat, lng });

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
      fssaiStatus: 'pending_application',
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

  // FSSAI applications for the two pending kitchens
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
      filingMode: 'facilitator',
      facilitationCostInPaise: 200000,
      sponsoredByPlatform: true,
      timelineJson: [
        { at: daysAgo(9).toISOString(), event: 'Application submitted to GharSe compliance team' },
        { at: daysAgo(7).toISOString(), event: 'Documents verified by back-office' },
        { at: daysAgo(6).toISOString(), event: 'Filed on FoSCoS — ref FOSCOS-TS-2026-118842' },
      ],
      createdAt: daysAgo(9),
      updatedAt: daysAgo(6),
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
        { at: daysAgo(2).toISOString(), event: 'Application submitted to GharSe compliance team' },
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
    { key: 'fssaiPendingMaxDays', value: '30' },
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
  }) {
    const subtotal = opts.items.reduce((s, i) => s + i.qty * i.unitPaise, 0);
    const createdAt = daysAgo(opts.createdDaysAgo);
    const [order] = await db
      .insert(orders)
      .values({
        buyerId: opts.buyerId,
        type: opts.type,
        sellerId: opts.sellerId,
        restaurantId: opts.restaurantId,
        status: opts.status,
        subtotalInPaise: subtotal,
        deliveryFeeInPaise: opts.deliveryFee,
        platformFeeInPaise: 0,
        commissionInPaise: commission(subtotal, opts.commissionPct),
        totalInPaise: subtotal + opts.deliveryFee,
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
  for (let i = 0; i < 9; i++) {
    await seedOrder({
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
    title: 'Welcome to GharSe 🎉',
    body: 'Home kitchens within 10 km of you are cooking today. Your order from Jain Rasoi is on the way!',
    href: '/orders',
  });

  console.log('Seed complete: 2 societies, 6 kitchens, 20 dishes, 1 mall, 15 orders, 1 demo complaint, 1 referral credit.');
}
