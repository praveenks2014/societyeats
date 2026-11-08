/**
 * Single source of truth for the product's identity. Everything user-visible
 * (metadata, manifest, service worker, receipts, invoices, legal pages, emails)
 * reads from here. To rename the product change the four values in
 * `brand.json` (NAME, SLUG, SHORT CODE, TAGLINE) and run `npm run icons:generate`.
 * The legal* placeholders MUST be replaced with real values before a real
 * launch — never ship an invoice with them.
 */
import identity from './brand.json';

const { name, slug, shortCode, tagline } = identity;

export const BRAND = {
  name,
  /** Convenience aliases kept for older call sites. */
  appName: name,
  shortName: name,
  slug,
  shortCode,
  tagline,
  shortPitch: 'Home-cooked food from verified kitchens in your society and the societies next door.',
  supportEmail: `support@${slug}.example`,
  supportWhatsApp: '+91 00000 00000',
  // ---- legal / tax placeholders (replace before launch) ----
  legalEntityName: `${name} (legal entity — to be filled)`,
  gstin: 'GSTIN-PENDING-REGISTRATION',
  registeredAddress: 'Registered address — to be filled before launch',
  grievanceOfficer: `Grievance Officer (placeholder) — grievance@${slug}.example`,
  platformFssaiLicenceNo: '',
  // ---- identifiers that leave the system ----
  /** Prefix for Razorpay receipts (`kt-`). */
  receiptPrefix: `${shortCode.toLowerCase()}-`,
  /** Fee-invoice prefix: `KT/2026-27/000001`. Existing invoices are never renumbered. */
  invoicePrefix: shortCode,
  /** Session cookie name (`<slug>_session`); other cookies and browser-storage keys use the same prefix. */
  cookiePrefix: slug,
  storagePrefix: slug,
  cookieName: `${slug}_session`,
  /** A browser-storage key such as `kootu_cart`. */
  storageKey: (key: string) => `${slug}_${key}`,
  /** Names this product has used before. The webhook still recognises them as ours (test orders already on the shared Razorpay account). */
  legacySlugs: ['padosiplate'] as readonly string[],
  /** Display names this product has used before (seeded text under these names is updated on bootstrap). */
  legacyNames: ['PadosiPlate'] as readonly string[],
  legacyReceiptPrefixes: ['pp-'] as readonly string[],
  legacyInvoicePrefixes: ['PP'] as readonly string[],
  legacyStoragePrefixes: ['padosi'] as readonly string[],
  /**
   * Domain-separation strings for key derivation and hashing. FROZEN: changing one would make stored encrypted documents unreadable
   * and change anonymous chat handles. They are not brand text and must not follow a rename.
   */
  cryptoContext: { docKey: 'padosi-doc-key', buyerHandle: 'padosi-handle' },
};

export type Brand = typeof BRAND;

/** Seeded text (legal documents, disclaimers) is written with `{{brand}}` / `{{slug}}` and resolved when it is seeded or served. */
export function brandText(text: string): string {
  return text.replaceAll('{{brand}}', BRAND.name).replaceAll('{{slug}}', BRAND.slug);
}
