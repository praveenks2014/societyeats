import Link from 'next/link';
import { BRAND } from '@/config/brand';
import { Disclaimer } from '@/components/disclaimer';
import { getPlatformSettings } from '@/lib/db/platform';

/** Global footer: marketplace + health disclaimers, legal links, the platform's own FSSAI licence number once entered. */
export async function SiteFooter() {
  const s = await getPlatformSettings().catch(() => null);
  const licence = s?.platformFssaiCentralLicenseNo?.trim();
  return (
    <footer className="mx-auto max-w-5xl space-y-3 px-4 pb-28 pt-6 sm:px-6" data-testid="site-footer">
      <Disclaimer id="marketplace" />
      <Disclaimer id="health" />
      <nav className="flex flex-wrap gap-x-4 text-xs font-semibold text-leaf [&_a]:inline-flex [&_a]:min-h-[44px] [&_a]:items-center" aria-label="Footer">
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/refunds">Refunds</Link>
        <Link href="/legal/grievance">Grievances</Link>
        <Link href="/legal/how-ranking-works">How ranking works</Link>
      </nav>
      <p className="text-xs text-ink-faint">
        © {BRAND.appName}
        {licence ? <span data-testid="platform-fssai"> · FSSAI e-commerce licence {licence}</span> : null}
      </p>
    </footer>
  );
}
