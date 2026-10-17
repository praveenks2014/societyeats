import Link from 'next/link';
import { Hero } from '@/components/hero';
import { Browse } from '@/components/browse';
import { FeaturedKitchen } from '@/components/featured-kitchen';
import { getFeaturedKitchen } from '@/lib/browse';
import { getPlatformSettings } from '@/lib/db/platform';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [featured, settings] = await Promise.all([getFeaturedKitchen(), getPlatformSettings()]);
  return (
    <>
      <Hero />
      {featured && (
        <FeaturedKitchen
          sellerId={featured.seller.id}
          kitchenName={featured.profile.kitchenName}
          bio={featured.profile.bio}
          rating={featured.profile.rating}
          ratingCount={featured.profile.ratingCount}
          societyName={featured.society?.name ?? null}
          photoUrl={featured.profile.kitchenPhotosJson?.[0] ?? featured.activeListings[0]?.photoUrl ?? null}
          badgeTier={featured.badgeTier}
        />
      )}
      <Browse />
      <footer className="mt-16 border-t border-rice-line pt-8 pb-4 text-xs text-ink-faint">
        <div className="flex flex-wrap gap-x-5">
          <Link href="/legal/terms" className="inline-flex min-h-[44px] items-center hover:text-ink">Terms</Link>
          <Link href="/legal/kitchen-terms" className="inline-flex min-h-[44px] items-center hover:text-ink">Kitchen terms</Link>
          <Link href="/legal/food-safety" className="inline-flex min-h-[44px] items-center hover:text-ink">Food safety</Link>
          <Link href="/legal/privacy" className="inline-flex min-h-[44px] items-center hover:text-ink">Privacy</Link>
          <Link href="/legal/refunds" className="inline-flex min-h-[44px] items-center hover:text-ink">Refunds</Link>
          {/* Pilot Hardening v2 — Phase 8 (DECISIONS.md #112+): Mall Mode is
              deferred this pilot (FEATURE_MALL_MODE off by default) — the code
              at /m/[mallSlug] still works, it's just not promoted here. */}
          {settings.mallModeEnabled && (
            <Link href="/m/gvk-one" className="inline-flex min-h-[44px] items-center hover:text-ink">Mall Mode (GVK One)</Link>
          )}
          <Link href="/register?as=seller" className="inline-flex min-h-[44px] items-center hover:text-ink">Become a home-chef</Link>
        </div>
        <p className="mt-4">
          Platform FSSAI license: applied for. Every kitchen on PadosiPlate shows its FSSAI number or a
          pending-application badge.
        </p>
      </footer>
    </>
  );
}
