import Link from 'next/link';
import { Hero } from '@/components/hero';
import { Browse } from '@/components/browse';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <>
      <Hero />
      <Browse />
      <footer className="mt-16 border-t border-rice-line pt-8 pb-4 text-xs text-ink-faint">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          <Link href="/legal/food-safety" className="hover:text-ink">Food safety</Link>
          <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/legal/refunds" className="hover:text-ink">Refunds</Link>
          <Link href="/m/gvk-one" className="hover:text-ink">Mall Mode (GVK One)</Link>
          <Link href="/register?as=seller" className="hover:text-ink">Become a home-chef</Link>
        </div>
        <p className="mt-4">
          Platform FSSAI license: applied for. Every kitchen on GharSe shows its FSSAI number or a
          pending-application badge.
        </p>
      </footer>
    </>
  );
}
