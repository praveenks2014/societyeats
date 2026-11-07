/**
 * Version of each legal document users consent to. A material change bumps the version, which makes
 * `reconsentRequired` true for everyone on the old one (see src/lib/legal/documents.ts).
 * Every document is a DRAFT pending lawyer review until the founder says otherwise.
 */
export const LEGAL_VERSIONS = {
  terms: '2026-11-draft1',
  privacy: '2026-11-draft1',
  'kitchen-terms': '2026-11-draft1',
} as const;
export type LegalSlug = keyof typeof LEGAL_VERSIONS;
