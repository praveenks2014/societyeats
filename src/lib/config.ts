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
  fssaiPendingMaxDays: 30, // listings auto-pause after this many days on "FSSAI pending"
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
};

export function isMockMode(): boolean {
  // MOCK_MODE=true by default; set MOCK_MODE=false plus real keys to go live.
  return process.env.MOCK_MODE !== 'false';
}
