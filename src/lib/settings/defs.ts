import { z } from 'zod';
import { DEFAULTS } from '@/lib/config';
import { BRAND } from '@/config/brand';

/**
 * Every admin-tunable platform setting, in one table: type, bounds, default,
 * label and grouping. The same table drives (1) getPlatformSettings(),
 * (2) PATCH /api/admin/settings validation and (3) the /admin/settings UI, so
 * a money or percentage field can never be saved without an integer + bounds
 * check. Money is stored as integer paise, percentages as integer basis
 * points (1% = 100 bps).
 */
type Base = { label: string; hint?: string; group: string };
export type IntDef = Base & { kind: 'int'; min: number; max: number; def: number; unit?: 'paise' | 'bps' | 'count' | 'days' | 'minutes' | 'rupees' };
export type NumDef = Base & { kind: 'number'; min: number; max: number; def: number; unit?: 'pct' | 'km' };
export type BoolDef = Base & { kind: 'bool'; def: boolean };
export type TextDef = Base & { kind: 'text'; def: string; pattern?: RegExp; patternHint?: string; maxLen?: number };
export type EnumDef = Base & { kind: 'enum'; options: readonly string[]; def: string };
export type Def = IntDef | NumDef | BoolDef | TextDef | EnumDef;

export const SETTING_DEFS = {
  // ---- buyer platform fee (the platform's revenue on every order) ----
  buyerPlatformFeeBps: { kind: 'int', unit: 'bps', min: 0, max: 2500, def: 1000, group: 'Pricing', label: 'Buyer platform fee (%)', hint: '% of the food value, paid by the buyer via Razorpay. 0–25%. Default 10.' },
  buyerPlatformFeeMinPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: 1000, group: 'Pricing', label: 'Platform fee floor (₹)', hint: 'Minimum fee per order. Default ₹10. 0 = no floor.' },
  buyerPlatformFeeMaxPaise: { kind: 'int', unit: 'paise', min: 0, max: 1_000_000, def: 2500, group: 'Pricing', label: 'Platform fee cap (₹)', hint: 'Maximum fee per order. Default ₹25. 0 = no cap.' },
  sellerDeliveryFeeEnabled: { kind: 'bool', def: false, group: 'Pricing', label: 'Kitchens may add a delivery fee', hint: 'Off for the pilot: delivery is included in the dish price. A separate delivery fee would make the platform liable for GST on local delivery (Notification 17/2025-CT(Rate)).' },
  platformFeeGstBps: { kind: 'int', unit: 'bps', min: 0, max: 2800, def: 1800, group: 'Tax', label: 'GST on platform fee & subscriptions (%)', hint: 'Applied only when a platform GSTIN is entered below; otherwise 0.' },
  platformGstin: { kind: 'text', def: '', maxLen: 15, pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, patternHint: 'a valid 15-character GSTIN, or blank', group: 'Tax', label: 'Platform GSTIN', hint: 'Leave blank until registered — GST is then not charged.' },
  gstMode: { kind: 'enum', options: ['unregistered', 'registered_fee_only', 'registered_eco_9_5'], def: 'unregistered', group: 'Tax', label: 'GST mode', hint: '⚠️ Confirm with your CA. unregistered: no GST charged. registered_fee_only: 18% GST on the platform fee (needs the GSTIN below). registered_eco_9_5: 18% on the fee PLUS 5% GST on the food value collected at booking (CGST Sec 9(5)); the kitchen must not charge GST on food.' },
  gstPositionConfirmedAt: { kind: 'text', def: '', maxLen: 40, group: 'Tax', label: 'GST position confirmed on (date)', hint: 'Required before live mode. Record the date your CA confirmed the mode above.' },
  gstPositionNote: { kind: 'text', def: '', maxLen: 300, group: 'Tax', label: 'GST position note', hint: 'For example: "CA confirmed registered_eco_9_5 on 12 Nov 2026".' },
  tdsWarnPaise: { kind: 'int', unit: 'paise', min: 0, max: 2_000_000_000, def: 40_000_000, group: 'Tax', label: 'Seller sales TDS warning (₹)', hint: 'Alert a seller and admin when FY gross food sales reach this. Default ₹4,00,000.' },
  tdsPausePaise: { kind: 'int', unit: 'paise', min: 0, max: 2_000_000_000, def: 50_000_000, group: 'Tax', label: 'Seller sales TDS pause (₹)', hint: 'New orders pause at this FY gross (Income-tax Act 2025 Sec 393, ex-194-O threshold). Default ₹5,00,000.' },
  ecoFoodGstBps: { kind: 'int', unit: 'bps', min: 0, max: 2800, def: 500, group: 'Tax', label: 'Food GST rate under Sec 9(5) (%)', hint: 'Used only in registered_eco_9_5 mode. Default 5.' },
  // ---- subscriptions ----
  subscriptionGraceDays: { kind: 'int', unit: 'days', min: 0, max: 30, def: 3, group: 'Subscriptions', label: 'Grace period after expiry (days)', hint: 'Listings stay visible, with a banner, during grace.' },
  subscriptionReminderDays: { kind: 'text', def: '7,3,1', pattern: /^\d{1,2}(,\d{1,2}){0,4}$/, patternHint: 'comma-separated days like 7,1', group: 'Subscriptions', label: 'Renewal reminders (days before expiry)', hint: 'Comma-separated, e.g. 7,3,1.' },
  // ---- order timing ----
  unpaidOrderExpiryMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 120, def: 15, group: 'Orders', label: 'Unpaid-fee order expiry (minutes)', hint: 'Orders whose platform fee is unpaid expire and release stock.' },
  preOrderMaxDays: { kind: 'int', unit: 'days', min: 1, max: 30, def: 7, group: 'Orders', label: 'Pre-orders: how far ahead (days)', hint: 'Buyers can schedule an order up to this many days in advance (needs the Scheduled pre-orders flag).' },
  preOrderAcceptLeadHours: { kind: 'int', unit: 'count', min: 1, max: 72, def: 4, group: 'Orders', label: 'Pre-orders: accept by this many hours before the slot', hint: 'A scheduled order auto-cancels (fee refunded) if the kitchen has not accepted this long before the slot. Never shorter than the normal acceptance window.' },
  sellerAcceptWindowMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 120, def: 20, group: 'Orders', label: 'Kitchen acceptance window (minutes)', hint: 'Unaccepted orders auto-cancel and the platform fee is refunded. Default 20.' },
  kitchenPaymentConfirmMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 240, def: 30, group: 'Orders', label: 'Kitchen UPI-confirmation reminder (minutes)', hint: 'After this long, both sides and admin are notified. Orders are never auto-cancelled for it.' },
  atDoorWaitMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 120, def: 15, group: 'Orders', label: 'Wait at the door before a no-show (minutes)', hint: 'After this long at the door with an unreachable buyer the kitchen may record a no-show.' },
  paymentClaimMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 240, def: 30, group: 'Orders', label: 'Buyer payment claim window (minutes)', hint: 'After collecting, the buyer is reminded after this long; then the kitchen may raise a dispute.' },
  sellerConfirmPaymentHours: { kind: 'int', unit: 'count', min: 1, max: 72, def: 12, group: 'Orders', label: 'Kitchen payment-confirmation window (hours)', hint: 'If the kitchen neither confirms nor disputes a claimed payment in this time the order auto-completes.' },
  buyerLateCancelFeeRetained: { kind: 'bool', def: true, group: 'Orders', label: 'Keep the platform fee when a buyer cancels after acceptance' },
  strikeWindowDays: { kind: 'int', unit: 'days', min: 1, max: 365, def: 30, group: 'Orders', label: 'Strike window (days)', hint: 'Strikes count inside this rolling window.' },
  sellerDeclineNudgeCount: { kind: 'int', unit: 'count', min: 1, max: 100, def: 5, group: 'Orders', label: 'Declines in the nudge window before admins are told', hint: 'A kitchen declining MORE than this many booked orders inside the window is flagged to admins (declines carry no strike).' },
  sellerDeclineNudgeDays: { kind: 'int', unit: 'days', min: 1, max: 60, def: 7, group: 'Orders', label: 'Decline nudge window (days)' },
  sellerStrikeLimit: { kind: 'int', unit: 'count', min: 1, max: 50, def: 3, group: 'Orders', label: 'Kitchen strikes before auto-pause', hint: 'Reaching it pauses the kitchen and sends it to admin review.' },
  buyerLateCancelsBeforeStrike: { kind: 'int', unit: 'count', min: 1, max: 20, def: 3, group: 'Orders', label: 'Buyer late cancellations before a strike', hint: 'Cancelling after the kitchen accepted. Counted inside the strike window.' },
  buyerStrikeLimit: { kind: 'int', unit: 'count', min: 1, max: 50, def: 3, group: 'Orders', label: 'Buyer strikes before an ordering block' },
  buyerBlockDays: { kind: 'int', unit: 'days', min: 1, max: 365, def: 14, group: 'Orders', label: 'Ordering block length (days)' },
  radiusKm: { kind: 'number', unit: 'km', min: 1, max: 50, def: DEFAULTS.radiusKm, group: 'Orders', label: 'Nearby radius (km)', hint: 'The hyperlocal boundary. Default 10.' },
  // ---- provisional FSSAI caps ----
  provisionalMaxOrdersPerDay: { kind: 'int', unit: 'count', min: 0, max: 500, def: 8, group: 'Provisional caps', label: 'Provisional: max orders per day', hint: 'Applies to kitchens whose FSSAI application is filed but not yet verified. Resets 00:00 IST.' },
  provisionalMaxFoodValuePerDayPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000_000, def: 250_000, group: 'Provisional caps', label: 'Provisional: max food value per day (₹)', hint: 'Default ₹2,500.' },
  provisionalMaxFoodValueTotalPaise: { kind: 'int', unit: 'paise', min: 0, max: 1_000_000_000, def: 2_500_000, group: 'Provisional caps', label: 'Provisional: max food value in total (₹)', hint: 'Default ₹25,000.' },
  provisionalMaxDays: { kind: 'int', unit: 'days', min: 0, max: 365, def: 45, group: 'Provisional caps', label: 'Provisional: max days', hint: 'After this long without verification, listings auto-pause.' },
  showComingSoon: { kind: 'bool', def: false, group: 'Provisional caps', label: 'Show "Coming soon" kitchens to their own society', hint: 'Kitchens whose FSSAI application is inside the deemed window.' },
  fssaiDeemedGrantDaysRegistration: { kind: 'int', unit: 'days', min: 1, max: 60, def: 7, group: 'FSSAI', label: 'Deemed-commencement window, Basic Registration (days)', hint: 'Rules verified Nov 2026; check FoSCoS for changes.' },
  fssaiAnnualFeeReminderDays: { kind: 'int', unit: 'days', min: 1, max: 60, def: 30, group: 'FSSAI', label: 'Annual-fee reminder lead (days)' },
  // ---- UPI ownership verification ----
  upiVerifyProvider: { kind: 'enum', options: ['razorpayx_rpd', 'razorpay_checkout_vpa', 'mock'], def: 'razorpay_checkout_vpa', group: 'UPI verification', label: 'UPI ownership check', hint: 'razorpayx_rpd needs a RazorpayX account (live only). razorpay_checkout_vpa uses the normal gateway. mock is for dev.' },
  upiNameMatchMinScore: { kind: 'int', unit: 'count', min: 0, max: 100, def: 70, group: 'UPI verification', label: 'Minimum PAN ↔ UPI name match (0–100)', hint: 'Below this the kitchen is flagged for admin; it is never auto-rejected.' },
  upiVerifyRefund: { kind: 'bool', def: true, group: 'UPI verification', label: 'Refund the ₹1 check automatically' },
  // ---- kitchen listing plan ----
  foundingKitchenOffer: { kind: 'bool', def: true, group: 'Subscriptions', label: '"Founding kitchen" free plan on approval', hint: '90 days free, then the monthly plan.' },
  sellerReferralFreeMonths: { kind: 'int', unit: 'count', min: 0, max: 12, def: 1, group: 'Referrals', label: 'Free plan months for referring a kitchen' },
  // ---- chat ----
  chatImagesEnabled: { kind: 'bool', def: true, group: 'Chat', label: 'Allow one image per chat message' },
  chatRetentionDays: { kind: 'int', unit: 'days', min: 30, max: 730, def: 180, group: 'Chat', label: 'Chat retention after order closure (days)' },
  chatReadOnlyHours: { kind: 'int', unit: 'count', min: 1, max: 720, def: 48, group: 'Chat', label: 'Chat stays open this many hours after completion' },
  chatBadWords: { kind: 'text', def: 'fuck,shit,bitch,asshole,bastard,madarchod,behenchod,chutiya,bhosdi,randi,harami,gaandu,kutta,saala', maxLen: 2000, group: 'Chat', label: 'Abusive words (comma-separated)', hint: 'A message containing one triggers a warning before sending. Reports and strikes handle repeat abuse.' },
  chatMaxLength: { kind: 'int', unit: 'count', min: 100, max: 4000, def: 1000, group: 'Chat', label: 'Max characters per message' },
  onboardingTargetHours: { kind: 'int', unit: 'count', min: 1, max: 336, def: 48, group: 'Moderation', label: 'Kitchen application review target (hours)', hint: 'Applications waiting longer than this are highlighted as overdue.' },
  topKitchenMinOrders: { kind: 'int', unit: 'count', min: 1, max: 200, def: 10, group: 'Moderation', label: 'Top Kitchen: minimum orders in 30 days' },
  topKitchenMinAcceptancePct: { kind: 'int', unit: 'count', min: 0, max: 100, def: 90, group: 'Moderation', label: 'Top Kitchen: minimum acceptance rate (%)' },
  topKitchenMaxCancelPct: { kind: 'int', unit: 'count', min: 0, max: 100, def: 5, group: 'Moderation', label: 'Top Kitchen: maximum kitchen-caused cancellation rate (%)' },
  topKitchenMinOnTimePct: { kind: 'int', unit: 'count', min: 0, max: 100, def: 80, group: 'Moderation', label: 'Top Kitchen: minimum on-time rate (%)' },
  topKitchenOnTimeMinutes: { kind: 'int', unit: 'minutes', min: 10, max: 240, def: 75, group: 'Moderation', label: 'On time = at the door within this many minutes of accepting' },
  topKitchenMinRating: { kind: 'number', min: 1, max: 5, def: 4.5, group: 'Moderation', label: 'Top Kitchen: minimum average rating' },
  // ---- notifications ----
  quietHoursStart: { kind: 'int', unit: 'count', min: 0, max: 23, def: 22, group: 'Notifications', label: 'Quiet hours start (hour, IST)', hint: 'Non-urgent push / WhatsApp / SMS wait out the night. In-app and email are unaffected.' },
  quietHoursEnd: { kind: 'int', unit: 'count', min: 0, max: 23, def: 7, group: 'Notifications', label: 'Quiet hours end (hour, IST)' },
  chatNotifyDebounceMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 60, def: 2, group: 'Notifications', label: 'Chat notification debounce (minutes)', hint: 'At most one chat alert per order per person in this window.' },
  pushEnabled: { kind: 'bool', def: true, group: 'Notifications', label: 'Web push on', hint: 'Needs VAPID keys (npm run vapid:generate). Off or missing keys: push is simply skipped.' },
  // ---- pilot ----
  pilotSocietiesOnly: { kind: 'bool', def: true, group: 'Pilot', label: 'Invite-only pilot', hint: 'Only members of active pilot societies can browse, order or sell.' },
  membershipAutoApprove: { kind: 'bool', def: true, group: 'Pilot', label: 'Auto-approve residents who join by invite link', hint: 'A society can be switched to manual approval in /admin/societies.' },
  packagedFoodsEnabled: { kind: 'bool', def: false, group: 'Pilot', label: 'Allow pre-packaged products', hint: 'Needs label fields (net quantity, dates, maker). Off for the pilot.' },
  dataRequestDays: { kind: 'int', unit: 'days', min: 1, max: 90, def: 30, group: 'Legal', label: 'Data request resolution (days)', hint: 'Access, correction and erasure requests (DPDP). Default 30.' },
  // ---- legal / consumer-protection identity ----
  supportEmail: { kind: 'text', def: '', maxLen: 120, group: 'Legal', label: 'Customer-care email' },
  supportPhone: { kind: 'text', def: '', maxLen: 20, group: 'Legal', label: 'Customer-care phone' },
  grievanceAckHours: { kind: 'int', unit: 'count', min: 1, max: 168, def: 48, group: 'Legal', label: 'Grievance acknowledgement (hours)', hint: 'E-Commerce Rules: acknowledge within 48 hours.' },
  grievanceResolveDays: { kind: 'int', unit: 'days', min: 1, max: 60, def: 30, group: 'Legal', label: 'Grievance resolution (days)', hint: 'E-Commerce Rules: resolve within one month. DPDP requests use the same bar.' },
  // ---- security ----
  adminSessionHours: { kind: 'int', unit: 'count', min: 1, max: 72, def: 12, group: 'Security', label: 'Admin session length (hours)' },
  loginLockMaxFailures: { kind: 'int', unit: 'count', min: 3, max: 50, def: 10, group: 'Security', label: 'Failed logins before lockout' },
  loginLockWindowMinutes: { kind: 'int', unit: 'minutes', min: 1, max: 240, def: 15, group: 'Security', label: 'Lockout window (minutes)' },
  verificationRetentionDays: { kind: 'int', unit: 'days', min: 30, max: 730, def: 180, group: 'Retention', label: 'Verification screenshots retention (days)', hint: '₹1-check evidence screenshots are deleted this long after the decision.' },
  backupKeepDaily: { kind: 'int', unit: 'count', min: 1, max: 90, def: 14, group: 'Retention', label: 'Backups: keep the newest daily ones', hint: 'One database backup is written to Object Storage every day at about 03:00 IST. The newest this many are kept.' },
  backupKeepWeekly: { kind: 'int', unit: 'count', min: 0, max: 52, def: 8, group: 'Retention', label: 'Backups: also keep this many weekly ones', hint: 'The first backup of each week is also marked weekly and kept longer than the daily ones.' },
  webhookEventRetentionDays: { kind: 'int', unit: 'days', min: 1, max: 365, def: 30, group: 'Retention', label: 'Payment webhook event IDs: keep for (days)', hint: 'Event IDs are kept only to ignore duplicate deliveries; on a Razorpay account shared with other apps this also holds the IDs of events that were not ours.' },
  loginCodeRetentionHours: { kind: 'int', unit: 'count', min: 1, max: 168, def: 24, group: 'Retention', label: 'Sign-in code retention (hours)', hint: 'Used or expired email codes are deleted after this long.' },
  accessLogMinRetentionDays: { kind: 'int', unit: 'days', min: 365, max: 3650, def: 365, group: 'Retention', label: 'Audit / access log minimum retention (days)', hint: 'DPDP Rules: keep processing logs at least 1 year. The audit log is never purged before this.' },
  cronStaleMinutes: { kind: 'int', unit: 'minutes', min: 5, max: 1440, def: 15, group: 'Security', label: 'Cron heartbeat warning (minutes)', hint: 'Admin banner when the scheduled jobs have not run for this long.' },
  // ---- revenue features (built, off for the pilot unless noted) ----
  mealPlansEnabled: { kind: 'bool', def: false, group: 'Feature flags', label: 'Meal plans (tiffin subscriptions)' },
  featuredEnabled: { kind: 'bool', def: false, group: 'Feature flags', label: 'Featured placement (always labelled Sponsored)' },
  plusEnabled: { kind: 'bool', def: false, group: 'Feature flags', label: `${BRAND.name} Plus (buyer membership)` },
  plusPriceMonthlyPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: 9900, group: 'Feature flags', label: 'Plus: monthly price (₹)' },
  plusFeeDiscountBps: { kind: 'int', unit: 'bps', min: 0, max: 10_000, def: 5000, group: 'Feature flags', label: 'Plus: platform-fee discount (%)' },
  plusMonthlyDiscountCapPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: 20_000, group: 'Feature flags', label: 'Plus: monthly discount cap (₹)' },
  mealPlanSkipCutoffHours: { kind: 'int', unit: 'count', min: 1, max: 72, def: 12, group: 'Feature flags', label: 'Meal plans: skip a day this many hours before its slot' },
  bulkMinPortions: { kind: 'int', unit: 'count', min: 2, max: 500, def: 15, group: 'Feature flags', label: 'Bulk orders: minimum portions' },
  bulkOrdersEnabled: { kind: 'bool', def: false, group: 'Feature flags', label: 'Bulk and party orders' },
  campaignsEnabled: { kind: 'bool', def: false, group: 'Feature flags', label: 'Festival campaigns' },
  favouritesEnabled: { kind: 'bool', def: true, group: 'Feature flags', label: 'Favourites and "kitchen is cooking" alerts' },
  preOrdersEnabled: { kind: 'bool', def: true, group: 'Feature flags', label: 'Scheduled pre-orders' },
  // ---- moderation & flags ----
  prohibitedKeywords: { kind: 'text', def: 'alcohol,liquor,beer,wine,whisky,whiskey,vodka,rum,bhang,cannabis,ganja,weed,raw meat,raw chicken,raw fish,raw mutton,home canned,home-canned,canned at home,infant formula,baby formula,baby food,protein powder,supplement,vitamin tablet', maxLen: 2000, group: 'Moderation', label: 'Prohibited keywords (comma-separated)', hint: 'A dish whose name, description or ingredients contains one is blocked at create/edit. Health claims (cure, weight loss, …) go to moderation instead.' },
  dishModerationEnabled: { kind: 'bool', def: true, group: 'Moderation', label: 'Dish moderation', hint: 'New dishes, and dishes whose name/photo changes or price moves >30%, wait for admin review.' },
  restaurantConsoleEnabled: { kind: 'bool', def: false, group: 'Feature flags', label: 'Restaurant (Mall) console', hint: 'Off for the pilot.' },
  mallModeEnabled: { kind: 'bool', def: DEFAULTS.mallModeEnabled, group: 'Feature flags', label: 'Mall Mode', hint: 'Off for the pilot.' },
  platformDeliveryEnabled: { kind: 'bool', def: DEFAULTS.platformDeliveryEnabled, group: 'Feature flags', label: 'Delivery-partner overflow', hint: 'Third-party delivery. Off for the pilot.' },
  // ---- FSSAI ----
  fssaiBasicFeePerYear: { kind: 'int', unit: 'rupees', min: 0, max: 10_000, def: 100, group: 'FSSAI', label: 'FSSAI Basic Registration fee per year (₹)', hint: 'Shown to sellers in the assistant. Government fee, paid directly to FSSAI.' },
  fssaiDocRetentionDays: { kind: 'int', unit: 'days', min: 0, max: 365, def: 30, group: 'FSSAI', label: 'ID document retention after verification (days)', hint: 'ID/address documents are auto-deleted this long after verification.' },
  platformFssaiCentralLicenseNo: { kind: 'text', def: DEFAULTS.platformFssaiCentralLicenseNo, pattern: /^\d{14}$/, patternHint: 'a 14-digit FSSAI licence number, or blank', group: 'FSSAI', label: 'Platform FSSAI licence no.', hint: 'The platform’s own e-commerce registration. Required before real (non-mock) orders.' },
  fssaiSponsorshipCapPerCohort: { kind: 'int', unit: 'count', min: 0, max: 1000, def: DEFAULTS.fssaiSponsorshipCapPerCohort, group: 'FSSAI', label: 'Legacy FSSAI sponsorship cap', hint: 'Legacy facilitation cohort cap.' },
  // ---- referrals ----
  referralCreditPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: DEFAULTS.referralCreditPaise, group: 'Referrals', label: 'Referral credit (₹)', hint: 'Credited to the referrer when a referred neighbour completes their first order. Applies to the platform fee only.' },
  referralCreditCapPerUser: { kind: 'int', unit: 'count', min: 0, max: 100, def: DEFAULTS.referralCreditCapPerUser, group: 'Referrals', label: 'Referral credits per user (lifetime)' },
  featuredSellerId: { kind: 'text', def: '', pattern: /^\d*$/, patternHint: 'a kitchen user id or blank', group: 'Referrals', label: 'Featured kitchen (user id)' },
  // ---- legal identity shown on invoices / legal pages ----
  legalEntityName: { kind: 'text', def: '', maxLen: 160, group: 'Legal', label: 'Legal entity name', hint: 'Overrides the placeholder on invoices and legal pages.' },
  registeredAddress: { kind: 'text', def: '', maxLen: 300, group: 'Legal', label: 'Registered address' },
  grievanceOfficer: { kind: 'text', def: '', maxLen: 200, group: 'Legal', label: 'Grievance officer (name, email)' },
  // ---- mall mode (flag off) ----
  commissionMallPct: { kind: 'number', unit: 'pct', min: 0, max: 50, def: DEFAULTS.commissionMallPct, group: 'Mall Mode', label: 'Mall commission (%)' },
  platformFeePaise: { kind: 'int', unit: 'paise', min: 0, max: 50_000, def: DEFAULTS.platformFeePaise, group: 'Mall Mode', label: 'Mall flat buyer fee (₹)' },
  platformDeliveryFeeInPaise: { kind: 'int', unit: 'paise', min: 0, max: 100_000, def: DEFAULTS.platformDeliveryFeeInPaise, group: 'Mall Mode', label: 'Delivery-partner fallback fee (₹)' },
  platformDeliveryMinOrderPaise: { kind: 'int', unit: 'paise', min: 0, max: 1_000_000, def: DEFAULTS.platformDeliveryMinOrderPaise, group: 'Mall Mode', label: 'Delivery-partner minimum order (₹)' },
  // ---- pilot metrics ----
  killWeek8PenetrationPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek8PenetrationPct, group: 'Pilot metrics', label: 'Week 8 — min penetration (%)' },
  killWeek8RetentionPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek8RetentionPct, group: 'Pilot metrics', label: 'Week 8 — min week-4 retention (%)' },
  killWeek14PenetrationPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek14PenetrationPct, group: 'Pilot metrics', label: 'Week 14 — min penetration (%)' },
  killWeek14RetentionPct: { kind: 'number', unit: 'pct', min: 0, max: 100, def: DEFAULTS.killWeek14RetentionPct, group: 'Pilot metrics', label: 'Week 14 — min week-4 retention (%)' },
} as const satisfies Record<string, Def>;

export type SettingKey = keyof typeof SETTING_DEFS;

type ValueOf<D> = D extends { kind: 'bool' }
  ? boolean
  : D extends { kind: 'int' | 'number' }
    ? number
    : D extends { kind: 'enum'; options: infer O extends readonly string[] }
      ? O[number]
      : string;

export type PlatformSettings = { [K in SettingKey]: ValueOf<(typeof SETTING_DEFS)[K]> };

/** zod validator for one setting (integers enforced, bounds enforced). */
export function validatorFor(key: SettingKey): z.ZodTypeAny {
  const d = SETTING_DEFS[key] as Def;
  switch (d.kind) {
    case 'int':
      return z.number({ error: `${d.label} must be a whole number` }).int(`${d.label} must be a whole number`).min(d.min, `${d.label} must be at least ${d.min}`).max(d.max, `${d.label} must be at most ${d.max}`);
    case 'number':
      return z.number({ error: `${d.label} must be a number` }).finite().min(d.min, `${d.label} must be at least ${d.min}`).max(d.max, `${d.label} must be at most ${d.max}`);
    case 'bool':
      return z.boolean({ error: `${d.label} must be true or false` });
    case 'enum':
      return z.enum(d.options as [string, ...string[]], { error: `${d.label} must be one of ${d.options.join(', ')}` });
    case 'text':
      return z
        .string()
        .trim()
        .max(d.maxLen ?? 300, `${d.label} is too long`)
        .refine((v) => v === '' || !d.pattern || d.pattern.test(v), `${d.label} must be ${d.patternHint ?? 'valid'}`);
  }
}

/** Validates a PATCH body. Throws a ZodError-like message list via `errors`. */
export function parseSettingsPatch(body: unknown): { values: Partial<Record<SettingKey, string | number | boolean>>; errors: string[] } {
  const values: Partial<Record<SettingKey, string | number | boolean>> = {};
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { values, errors: ['Body must be an object'] };
  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    if (!(key in SETTING_DEFS)) {
      errors.push(`Unknown setting: ${key}`);
      continue;
    }
    const r = validatorFor(key as SettingKey).safeParse(raw);
    if (!r.success) errors.push(r.error.issues[0].message);
    else values[key as SettingKey] = r.data as string | number | boolean;
  }
  return { values, errors };
}

/** Cross-field rules, checked against the merged result. */
export function crossCheck(merged: PlatformSettings): string[] {
  const errs: string[] = [];
  if (merged.buyerPlatformFeeMaxPaise > 0 && merged.buyerPlatformFeeMaxPaise < merged.buyerPlatformFeeMinPaise) {
    errs.push('Platform fee cap must be at least the floor (or 0 for no cap)');
  }
  if (merged.gstMode !== 'unregistered' && !merged.platformGstin) errs.push('A platform GSTIN is required for the selected GST mode');
  if (merged.tdsPausePaise > 0 && merged.tdsWarnPaise > merged.tdsPausePaise) errs.push('The TDS warning level must not exceed the pause level');
  return errs;
}

export function parseReminderDays(csv: string): number[] {
  return [...new Set(csv.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => b - a);
}
