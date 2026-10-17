export const dynamic = 'force-dynamic';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="prose-sm mx-auto max-w-2xl pt-8 leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_p]:mt-3 [&_p]:text-sm [&_p]:text-ink-soft [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 [&_li]:text-sm [&_li]:text-ink-soft">
      <p className="rounded-2xl bg-turmeric-tint px-4 py-3 text-xs font-semibold text-turmeric-deep" role="note" data-testid="legal-draft">
        Draft – to be reviewed by a lawyer.
      </p>
      {children}
      <nav className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-leaf" aria-label="Legal pages">
        <a href="/legal/terms">Terms</a>
        <a href="/legal/kitchen-terms">Kitchen terms</a>
        <a href="/legal/refunds">Refund policy</a>
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/food-safety">Food safety</a>
      </nav>
      <p className="mt-6 rounded-2xl bg-rice-deep px-4 py-3 text-xs">
        These pages are working drafts for the pilot and are not legal advice. Have counsel review before wider launch.
      </p>
    </article>
  );
}
