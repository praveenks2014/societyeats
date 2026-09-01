/**
 * Single place to rebrand the product and tune platform economics.
 * DB-backed overrides (admin-editable) live in platform_config and are read
 * via getPlatformConfig() in src/lib/db/platform.ts.
 */
export const BRAND = {
  name: 'GharSe',
  tagline: 'Ghar ka khana, from your neighbourhood',
  shortPitch:
    'Home-cooked food from verified kitchens in your society, delivered within 10 km.',
  supportEmail: 'support@gharse.example',
  grievanceOfficer: 'Grievance Officer (placeholder) — grievance@gharse.example',
  // Pilot Hardening v2 — Phase 3 (Money, DECISIONS.md #58+). Placeholders for
  // the tax-invoice letterhead: GharSe is the deemed supplier under Sec 9(5)
  // CGST for home-food orders, so invoices are issued in the platform's name.
  // REPLACE with the real GSTIN and registered address once allotted —
  // never ship a real invoice with these placeholder values.
  gstin: 'GSTIN-PENDING-REGISTRATION',
  registeredAddress: 'GharSe Technologies (address on file — update before pilot launch)',
};

export const DEFAULTS = {
  radiusKm: 10,
  commissionHomePct: 12, // home-cook orders
  commissionMallPct: 6, // mall restaurant orders
  platformFeePaise: 0, // buyer platform fee (₹0 at launch) — the brief's "buyerPlatformFeeInPaise"
  deliveryProviderTimeoutMs: 8000,
  providerAutoDisableAfterFailures: 5,
  sellerProPricePaise: 29900, // ₹299/mo, billing is Phase 2
  // Pilot Hardening v2 — fulfillment pivot (DECISIONS.md #37+).
  platformDeliveryEnabled: false, // feature flag: platform-facilitated (3rd-party) delivery overflow
  platformDeliveryFeeInPaise: 4900, // fallback fee when no live/mock provider quote is available (matches orchestrator's own ₹49 fallback)
  platformDeliveryMinOrderPaise: 25000, // ₹250 — founder-specified minimum order for platform delivery eligibility
  gstPct: 5, // GST on home-food orders; GharSe is the deemed supplier under Sec 9(5) CGST — not admin-tunable, so not in platform_config
  // Pilot Hardening v2 — Phase 3 (Money: invoices, payouts, tax; DECISIONS.md #51+).
  gatewayFeeEstimatePct: 2, // estimated Razorpay processing cost, shown on payouts for margin visibility — not admin-tunable (an accounting estimate, not a pricing lever)
  tds194OPct: 0.1, // Sec 194-O TDS rate on gross sales facilitated, once the threshold below is crossed in a financial year
  tds194OThresholdPaise: 50000000, // ₹5,00,000 — statutory Sec 194-O threshold for resident individual/HUF sellers
  // Pilot Hardening v2 — Phase 4 (Compliance center refinements, DECISIONS.md #62+).
  fssaiSponsorshipCapPerCohort: 10, // founder-specified: facilitation sponsored for at most this many sellers
  platformFssaiCentralLicenseNo: '', // empty until the real Central FSSAI e-commerce license is entered by an admin
  // Pilot Hardening v2 — Phase 5 (Trust & hygiene, DECISIONS.md #73+). Fixed
  // policy constants, not admin-tunable — same treatment as gstPct/tds194OPct
  // above (a trust/safety rule, not a pricing lever an admin should casually retune).
  minKitchenPhotosRequired: 3, // onboarding: kitchen photos required before the "complete your profile" nudge clears
  complaintWindowHours: 24, // buyer can raise a complaint within this many hours of delivery/pickup
  hygieneAutoPauseThreshold: 3, // this many UPHELD 'hygiene' complaints auto-pauses the seller
  // Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md #87+).
  referralCreditPaise: 3000, // ₹30 credit to the referrer once a referred neighbour completes their first order
  referralCreditCapPerUser: 5, // lifetime cap on how many credits one referrer can earn
  featuredSellerId: '', // platform_config only — empty until an admin picks a "kitchen of the week"
  sellerOrderBadgeTiers: [10, 50, 100], // completed-order milestones a seller's profile badges at
  // Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md #99+).
  // Fixed target lines shown BESIDE the actuals on /admin/metrics (not a
  // pricing/config lever an admin retunes — same treatment as gstPct — these
  // are the brief's own stated targets, verbatim).
  buyerRetentionTargetPct: 15, // week-4 buyer retention target (>= 15%)
  refundComplaintRateTargetPct: 3, // refund/complaint rate target (< 3%)
  // Kill/pivot checkpoint thresholds — admin-editable via platform_config
  // (/admin/settings), separate from the fixed display targets above: a
  // checkpoint threshold is a deliberately tunable go/no-go bar an admin may
  // want to loosen or tighten as the pilot actually plays out, whereas the
  // targets above are the brief's fixed reference lines. Week-8 bars start
  // below the steady-state 15%/target line (an 8-week-old pilot isn't
  // expected to already be at steady state); week-14 converges toward it.
  killWeek8PenetrationPct: 20, // % of target households registered, checked at week 8
  killWeek8RetentionPct: 8, // week-4 buyer retention, checked at week 8
  killWeek14PenetrationPct: 35, // % of target households registered, checked at week 14
  killWeek14RetentionPct: 15, // week-4 buyer retention, checked at week 14 (matches the steady-state target)
  // Pilot Hardening v2 — Phase 8 (Feature flags, seed, docs; DECISIONS.md
  // #112+). Mall Mode's single-store code path is fully retained (see
  // src/app/m/[mallSlug]) but deferred for this pilot per the founder's
  // fixed decision — gated off by default, admin-flippable for a future demo
  // without a redeploy, exactly like platformDeliveryEnabled above.
  mallModeEnabled: false,
  // FSSAI hardening v3 (DECISIONS.md #119+). Statutory "deemed commencement"
  // windows — fixed constants, not admin-tunable, same treatment as gstPct/
  // hygieneAutoPauseThreshold above (a regulatory rule, not a pricing/policy
  // lever an admin should casually retune). See src/lib/fssai/gate.ts.
  fssaiDeemedGrantDaysRegistration: 7, // Basic Registration
  fssaiDeemedGrantDaysState: 60, // State License
};

export function isMockMode(): boolean {
  // MOCK_MODE=true by default; set MOCK_MODE=false plus real keys to go live.
  return process.env.MOCK_MODE !== 'false';
}
