import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { consents, legalDocuments, legalDocumentVersions } from '@/lib/db/schema';
import { LEGAL_VERSIONS } from '@/lib/legal/versions';
import { LEGAL_SLUGS, SEED_DOCS, type LegalDocSlug } from '@/lib/legal/seed-docs';

type Db = Awaited<ReturnType<typeof getDb>>;

/** Slugs a user consents to, and the consent `kind` each is recorded under. */
export const CONSENT_DOCS = { terms: 'terms', privacy: 'privacy', 'kitchen-terms': 'kitchen_terms' } as const;
export type ConsentDocSlug = keyof typeof CONSENT_DOCS;

/** Version 1 keeps the label already stored in existing consent rows; later versions are `v2`, `v3`… */
export function versionLabel(slug: ConsentDocSlug, version: number): string {
  return version <= 1 ? LEGAL_VERSIONS[slug] : `v${version}`;
}

export function isLegalSlug(s: string): s is LegalDocSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(s);
}

/** Idempotent: inserts missing documents at version 1 (draft) and never touches an existing row. */
export async function seedLegalDocuments(db?: Db): Promise<number> {
  const d = db ?? (await getDb());
  let added = 0;
  for (const doc of SEED_DOCS) {
    const rows = await d.insert(legalDocuments).values({ slug: doc.slug, version: 1, title: doc.title, body: doc.body, effectiveDate: '2026-11-07', changeSummary: 'Initial draft for the pilot.' }).onConflictDoNothing().returning({ slug: legalDocuments.slug });
    if (rows.length) {
      added++;
      await d.insert(legalDocumentVersions).values({ slug: doc.slug, version: 1, title: doc.title, body: doc.body, material: false, changeSummary: 'Initial draft for the pilot.', effectiveDate: '2026-11-07' }).onConflictDoNothing();
    }
  }
  return added;
}

export async function getLegalDocument(slug: string) {
  const db = await getDb();
  const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.slug, slug));
  if (row) return row;
  const seed = SEED_DOCS.find((s) => s.slug === slug);
  if (!seed) return null;
  // Before bootstrap has run: serve the built-in draft so the page never 404s.
  return { slug, version: 1, title: seed.title, body: seed.body, reconsentRequired: false, publishedAt: new Date(0), reviewStatus: 'draft', reviewedAt: null, reviewedBy: null, effectiveDate: null, changeSummary: null };
}

export async function listLegalDocuments() {
  const db = await getDb();
  return db.select().from(legalDocuments).orderBy(legalDocuments.slug);
}

export async function legalVersions(slug: string) {
  const db = await getDb();
  return db.select().from(legalDocumentVersions).where(eq(legalDocumentVersions.slug, slug)).orderBy(desc(legalDocumentVersions.version));
}

/** Publishes a new version. The text goes back to `draft` review status; a material change asks everyone to re-consent. */
export async function publishLegalDocument(slug: LegalDocSlug, input: { title: string; body: string; material: boolean; changeSummary: string; effectiveDate?: string }, adminId: number): Promise<number> {
  const title = input.title.trim();
  const body = input.body.trim();
  const summary = input.changeSummary.trim();
  if (title.length < 3 || body.length < 40) throw new Error('Title and body are required');
  if (!summary) throw new Error('Describe what changed (shown to users on re-consent)');
  await seedLegalDocuments();
  const db = await getDb();
  const [cur] = await db.select().from(legalDocuments).where(eq(legalDocuments.slug, slug));
  if (cur.title === title && cur.body === body) return cur.version;
  const version = cur.version + 1;
  const effectiveDate = input.effectiveDate || new Date().toISOString().slice(0, 10);
  const upd = await db
    .update(legalDocuments)
    .set({ version, title, body, reconsentRequired: input.material, publishedAt: new Date(), reviewStatus: 'draft', reviewedAt: null, reviewedBy: null, effectiveDate, changeSummary: summary })
    .where(and(eq(legalDocuments.slug, slug), eq(legalDocuments.version, cur.version)))
    .returning({ slug: legalDocuments.slug });
  if (!upd.length) throw new Error('Someone else published this document; reload and try again');
  await db.insert(legalDocumentVersions).values({ slug, version, title, body, material: input.material, changeSummary: summary, effectiveDate, publishedBy: adminId });
  return version;
}

/** Marks the CURRENT version as reviewed by counsel (removes the draft label). */
export async function markLegalReviewed(slug: LegalDocSlug, adminId: number): Promise<void> {
  await seedLegalDocuments();
  const db = await getDb();
  await db.update(legalDocuments).set({ reviewStatus: 'reviewed', reviewedAt: new Date(), reviewedBy: adminId }).where(eq(legalDocuments.slug, slug));
}

export type PendingReconsent = { slug: ConsentDocSlug; title: string; version: number; label: string; changeSummary: string | null };

/**
 * Documents whose current version the user has not accepted, after they accepted an earlier one.
 * Only a material publish (`reconsentRequired`) asks again; a user who never accepted a doc
 * (e.g. a buyer and kitchen-terms) is not asked. Kitchen terms apply to sellers only.
 */
export async function pendingReconsent(userId: number, role: string): Promise<PendingReconsent[]> {
  const db = await getDb();
  const slugs = (Object.keys(CONSENT_DOCS) as ConsentDocSlug[]).filter((s) => s !== 'kitchen-terms' || role === 'seller');
  const docs = await db.select().from(legalDocuments).where(inArray(legalDocuments.slug, slugs));
  const out: PendingReconsent[] = [];
  for (const doc of docs) {
    if (!doc.reconsentRequired || doc.version <= 1) continue;
    const slug = doc.slug as ConsentDocSlug;
    const [latest] = await db.select().from(consents).where(and(eq(consents.userId, userId), eq(consents.kind, CONSENT_DOCS[slug]))).orderBy(desc(consents.acceptedAt), desc(consents.id)).limit(1);
    if (!latest) continue; // never accepted this one (e.g. kitchen terms before onboarding): not a re-consent
    const label = versionLabel(slug, doc.version);
    if (latest.version === label) continue;
    out.push({ slug, title: doc.title, version: doc.version, label, changeSummary: doc.changeSummary });
  }
  return out;
}

export async function acceptReconsent(userId: number, role: string, slugs: string[], ip?: string | null): Promise<number> {
  const pending = await pendingReconsent(userId, role);
  const db = await getDb();
  let n = 0;
  for (const p of pending) {
    if (!slugs.includes(p.slug)) continue;
    await db.insert(consents).values({ userId, kind: CONSENT_DOCS[p.slug], version: p.label, ip: ip ?? null });
    n++;
  }
  return n;
}

/** The consent version label to record at sign-up for the document as it stands now. */
export async function currentConsentLabel(slug: ConsentDocSlug): Promise<string> {
  const doc = await getLegalDocument(slug);
  return versionLabel(slug, doc?.version ?? 1);
}

/**
 * The built-in draft text for a slug next to what is live now, for the admin "Compare with latest seed draft" view. Read-only: it never
 * writes. `adminEdited` is true once an admin has published a version (so the live text is not the untouched seed any more).
 */
export async function compareWithSeed(slug: LegalDocSlug) {
  await seedLegalDocuments();
  const seed = SEED_DOCS.find((d) => d.slug === slug)!;
  const db = await getDb();
  const [cur] = await db.select().from(legalDocuments).where(eq(legalDocuments.slug, slug));
  const versions = await db.select({ publishedBy: legalDocumentVersions.publishedBy }).from(legalDocumentVersions).where(eq(legalDocumentVersions.slug, slug));
  return {
    current: { title: cur.title, body: cur.body, version: cur.version },
    seed: { title: seed.title, body: seed.body },
    identical: cur.title === seed.title && cur.body === seed.body,
    adminEdited: versions.some((v) => v.publishedBy != null),
  };
}
