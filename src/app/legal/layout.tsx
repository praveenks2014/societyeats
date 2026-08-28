export const dynamic = 'force-dynamic';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="prose-sm mx-auto max-w-2xl pt-8 leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_p]:mt-3 [&_p]:text-sm [&_p]:text-ink-soft [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 [&_li]:text-sm [&_li]:text-ink-soft">
      {children}
      <p className="mt-10 rounded-2xl bg-rice-deep px-4 py-3 text-xs">
        These pages are working drafts for the GharSe pilot and are not legal advice. Have counsel
        review before public launch.
      </p>
    </article>
  );
}
