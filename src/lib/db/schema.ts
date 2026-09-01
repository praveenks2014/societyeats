import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------- enums ----------

export const roleEnum = pgEnum('role', ['buyer', 'seller', 'restaurant', 'admin']);

export const fssaiStatusEnum = pgEnum('fssai_status', [
  'verified',
  'pending_application',
  'unverified',
]);

export const fssaiAppStatusEnum = pgEnum('fssai_app_status', [
  'draft',
  'submitted_to_backoffice',
  'filed_on_foscos',
  'granted',
  'rejected',
]);

export const licenseTypeEnum = pgEnum('license_type', ['registration', 'state']);

export const orderTypeEnum = pgEnum('order_type', ['home_delivery', 'mall_pickup']);

export const orderStatusEnum = pgEnum('order_status', [
  'placed',
  'paid',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'picked_up',
  'cancelled',
  'refund_pending',
  'delivery_unassigned',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded',
]);

export const deliveryProviderEnum = pgEnum('delivery_provider', [
  'porter',
  'shadowfax',
  'borzo',
  'mock',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'rider_assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'failed',
  'cancelled',
]);

export const subscriptionPlanEnum = pgEnum('subscription_plan', ['free', 'pro']);

// ---------- core tables ----------

export const societies = pgTable(
  'societies',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    city: varchar('city', { length: 80 }).notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    addressText: text('address_text').notNull(),
  },
  (table) => [index('societies_lat_lng_idx').on(table.lat, table.lng)],
);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    phone: varchar('phone', { length: 15 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('buyer'),
    societyId: integer('society_id').references(() => societies.id),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  // Backs the SQL Haversine radius filter in src/lib/browse.ts (browseListings).
  (table) => [index('users_lat_lng_idx').on(table.lat, table.lng)],
);

export const sellerProfiles = pgTable('seller_profiles', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  kitchenName: varchar('kitchen_name', { length: 160 }).notNull(),
  bio: text('bio'),
  fssaiNumber: varchar('fssai_number', { length: 14 }),
  fssaiStatus: fssaiStatusEnum('fssai_status').notNull().default('unverified'),
  fssaiExpiry: date('fssai_expiry'),
  isApproved: boolean('is_approved').notNull().default(false),
  vegOnly: boolean('veg_only').notNull().default(false),
  rating: doublePrecision('rating').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  payoutVpaOrBank: varchar('payout_vpa_or_bank', { length: 160 }),
});

export const fssaiApplications = pgTable('fssai_applications', {
  id: serial('id').primaryKey(),
  sellerId: integer('seller_id')
    .notNull()
    .references(() => users.id),
  applicantName: varchar('applicant_name', { length: 160 }).notNull(),
  kitchenAddress: text('kitchen_address').notNull(),
  licenseType: licenseTypeEnum('license_type').notNull().default('state'),
  documentsJson: jsonb('documents_json').$type<{ label: string; url: string }[]>(),
  status: fssaiAppStatusEnum('status').notNull().default('draft'),
  foscosRefNumber: varchar('foscos_ref_number', { length: 60 }),
  timelineJson: jsonb('timeline_json').$type<{ at: string; event: string }[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const listings = pgTable('listings', {
  id: serial('id').primaryKey(),
  sellerId: integer('seller_id')
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 160 }).notNull(),
  description: text('description'),
  priceInPaise: integer('price_in_paise').notNull(),
  isVeg: boolean('is_veg').notNull().default(true),
  cuisine: varchar('cuisine', { length: 60 }).notNull(),
  photoUrl: text('photo_url'),
  prepTimeMins: integer('prep_time_mins').notNull().default(30),
  availableQty: integer('available_qty').notNull().default(0),
  slotsJson: jsonb('slots_json').$type<{ days: string[]; slots: string[] }>(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------- mall mode ----------

export const malls = pgTable('malls', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 160 }).notNull(),
  city: varchar('city', { length: 80 }).notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
});

export const restaurants = pgTable('restaurants', {
  id: serial('id').primaryKey(),
  mallId: integer('mall_id')
    .notNull()
    .references(() => malls.id),
  name: varchar('name', { length: 160 }).notNull(),
  counterNumber: varchar('counter_number', { length: 20 }).notNull(),
  managerUserId: integer('manager_user_id').references(() => users.id),
  fssaiNumber: varchar('fssai_number', { length: 14 }),
  logoUrl: text('logo_url'),
});

export const restaurantItems = pgTable('restaurant_items', {
  id: serial('id').primaryKey(),
  restaurantId: integer('restaurant_id')
    .notNull()
    .references(() => restaurants.id),
  title: varchar('title', { length: 160 }).notNull(),
  priceInPaise: integer('price_in_paise').notNull(),
  isVeg: boolean('is_veg').notNull().default(true),
  photoUrl: text('photo_url'),
  stockQty: integer('stock_qty').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

// ---------- orders & payments ----------

export type DeliveryAddress = {
  label: string;
  flat: string;
  societyName: string;
  addressText: string;
  lat: number;
  lng: number;
};

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  buyerId: integer('buyer_id')
    .notNull()
    .references(() => users.id),
  type: orderTypeEnum('type').notNull(),
  sellerId: integer('seller_id').references(() => users.id),
  restaurantId: integer('restaurant_id').references(() => restaurants.id),
  status: orderStatusEnum('status').notNull().default('placed'),
  subtotalInPaise: integer('subtotal_in_paise').notNull(),
  deliveryFeeInPaise: integer('delivery_fee_in_paise').notNull().default(0),
  platformFeeInPaise: integer('platform_fee_in_paise').notNull().default(0),
  commissionInPaise: integer('commission_in_paise').notNull().default(0),
  totalInPaise: integer('total_in_paise').notNull(),
  deliveryAddressJson: jsonb('delivery_address_json').$type<DeliveryAddress>(),
  otpCode: varchar('otp_code', { length: 4 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  listingId: integer('listing_id').references(() => listings.id),
  restaurantItemId: integer('restaurant_item_id').references(() => restaurantItems.id),
  titleSnapshot: varchar('title_snapshot', { length: 160 }).notNull(),
  qty: integer('qty').notNull(),
  unitPriceInPaise: integer('unit_price_in_paise').notNull(),
});

export const orderEvents = pgTable('order_events', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  status: varchar('status', { length: 40 }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  razorpayOrderId: varchar('razorpay_order_id', { length: 80 }),
  razorpayPaymentId: varchar('razorpay_payment_id', { length: 80 }),
  status: paymentStatusEnum('status').notNull().default('created'),
  method: varchar('method', { length: 40 }),
  capturedAt: timestamp('captured_at'),
  webhookPayloadJson: jsonb('webhook_payload_json'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------- delivery orchestration ----------

export type DeliveryAttempt = {
  provider: string;
  at: string;
  outcome: 'success' | 'failed' | 'timeout';
  detail?: string;
};

export const deliveries = pgTable('deliveries', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  provider: deliveryProviderEnum('provider').notNull(),
  providerOrderId: varchar('provider_order_id', { length: 80 }),
  status: deliveryStatusEnum('status').notNull().default('pending'),
  riderName: varchar('rider_name', { length: 120 }),
  riderPhone: varchar('rider_phone', { length: 15 }),
  trackingUrl: text('tracking_url'),
  quoteInPaise: integer('quote_in_paise'),
  attemptsJson: jsonb('attempts_json').$type<DeliveryAttempt[]>(),
  dispatchedAt: timestamp('dispatched_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const providerHealth = pgTable('provider_health', {
  provider: deliveryProviderEnum('provider').primaryKey(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  priority: integer('priority').notNull().default(100),
  lastSuccessAt: timestamp('last_success_at'),
  lastFailureAt: timestamp('last_failure_at'),
  failureCount: integer('failure_count').notNull().default(0),
  chaosForceFail: boolean('chaos_force_fail').notNull().default(false),
});

// ---------- reviews, subscriptions, config, notifications ----------

export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  buyerId: integer('buyer_id')
    .notNull()
    .references(() => users.id),
  rating: integer('rating').notNull(),
  text: text('text'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  sellerId: integer('seller_id')
    .primaryKey()
    .references(() => users.id),
  plan: subscriptionPlanEnum('plan').notNull().default('free'),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  renewsAt: timestamp('renews_at'),
});

export const platformConfig = pgTable('platform_config', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: text('value').notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body'),
  href: varchar('href', { length: 200 }),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
