import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="prose-sm mx-auto max-w-2xl pt-8 leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_p]:mt-3 [&_p]:text-sm [&_p]:text-ink-soft [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 [&_li]:text-sm [&_li]:text-ink-soft">
      {children}
      <nav className="mt-8 flex flex-wrap gap-x-4 text-xs font-semibold text-leaf [&_a]:inline-flex [&_a]:min-h-[44px] [&_a]:items-center" aria-label="Legal pages">
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/kitchen-terms">Kitchen terms</Link>
        <Link href="/legal/refunds">Refund policy</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/food-safety">Food safety</Link>
        <Link href="/legal/grievance">Grievances</Link>
        <Link href="/legal/prohibited-items">Prohibited items</Link>
        <Link href="/legal/community-guidelines">Community guidelines</Link>
        <Link href="/legal/how-ranking-works">How ranking works</Link>
        <Link href="/legal/fssai-help">FSSAI help</Link>
      </nav>
    </article>
  );
}
