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
};

export const DEFAULTS = {
  radiusKm: 10,
  commissionHomePct: 12, // home-cook orders
  commissionMallPct: 6, // mall restaurant orders
  platformFeePaise: 0, // buyer platform fee (₹0 at launch)
  fssaiPendingMaxDays: 30, // listings auto-pause after this many days on "FSSAI pending"
  deliveryProviderTimeoutMs: 8000,
  providerAutoDisableAfterFailures: 5,
  sellerProPricePaise: 29900, // ₹299/mo, billing is Phase 2
};

export function isMockMode(): boolean {
  // MOCK_MODE=true by default; set MOCK_MODE=false plus real keys to go live.
  return process.env.MOCK_MODE !== 'false';
}
