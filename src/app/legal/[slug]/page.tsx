import { notFound } from 'next/navigation';
import { Disclaimer } from '@/components/disclaimer';
import { getPlatformSettings } from '@/lib/db/platform';
import { getSession } from '@/lib/auth';
import { getLegalDocument, isLegalSlug } from '@/lib/legal/docs';
import { fillLegal, legalVars, renderMarkdown } from '@/lib/legal/render';
import { GrievanceForm } from '@/components/grievance-form';
import type { DisclaimerId } from '@/lib/disclaimers/defs';

export const dynamic = 'force-dynamic';

/** Disclaimers that belong at the bottom of a given legal document. */
const EXTRAS: Record<string, DisclaimerId[]> = {
  terms: ['off-platform', 'liability', 'marketplace'],
  'kitchen-terms': ['tax-seller', 'fssai-provisional'],
  refunds: ['cancellation'],
  'food-safety': ['home-kitchen', 'allergens'],
  'fssai-help': ['fssai-help'],
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = isLegalSlug(slug) ? await getLegalDocument(slug) : null;
  return { title: doc?.title ?? 'Legal' };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const doc = await getLegalDocument(slug);
  if (!doc) notFound();
  const s = await getPlatformSettings();
  const body = fillLegal(doc.body, legalVars(s));
  const session = slug === 'grievance' ? await getSession() : null;
  const reviewed = doc.reviewStatus === 'reviewed';
  return (
    <>
      <p className={`rounded-2xl px-4 py-3 text-xs font-semibold ${reviewed ? 'bg-leaf-tint text-leaf' : 'bg-turmeric-tint text-turmeric-deep'}`} role="note" data-testid="legal-draft" data-review-status={doc.reviewStatus}>
        {reviewed ? `Reviewed by counsel${doc.reviewedAt ? ` on ${new Date(doc.reviewedAt).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' })}` : ''} · version ${doc.version}` : `Draft, pending lawyer review · version ${doc.version}`}
        {doc.effectiveDate ? ` · effective ${doc.effectiveDate}` : ''}
      </p>
      <div data-testid="legal-body">{renderMarkdown(body)}</div>
      {slug === 'grievance' && <GrievanceForm signedIn={!!session} />}
      <div className="mt-6 space-y-2">
        {(EXTRAS[slug] ?? []).map((id) => (
          <Disclaimer key={id} id={id} />
        ))}
      </div>
    </>
  );
}
