/**
 * Single source of truth for the product's identity. Everything user-visible
 * (metadata, manifest copy, receipts, invoices, legal pages, emails) reads
 * from here. The legal* placeholders MUST be replaced with real values
 * before a real launch — never ship an invoice with them.
 */
export const BRAND = {
  appName: 'PadosiPlate',
  shortName: 'Padosi',
  tagline: 'Home food from your neighbours',
  shortPitch:
    'Home-cooked food from verified kitchens in your society and the societies next door.',
  supportEmail: 'support@padosiplate.example',
  supportWhatsApp: '+91 00000 00000',
  // ---- legal / tax placeholders (replace before launch) ----
  legalEntityName: 'PadosiPlate (legal entity — to be filled)',
  gstin: 'GSTIN-PENDING-REGISTRATION',
  registeredAddress: 'Registered address — to be filled before launch',
  grievanceOfficer: 'Grievance Officer (placeholder) — grievance@padosiplate.example',
  platformFssaiLicenceNo: '',
  /** Prefix for Razorpay receipts. */
  receiptPrefix: 'pp_',
  /** Session cookie name. */
  cookieName: 'padosi_session',
  /** Convenience alias kept for older call sites. */
  get name() {
    return this.appName;
  },
};

export type Brand = typeof BRAND;
