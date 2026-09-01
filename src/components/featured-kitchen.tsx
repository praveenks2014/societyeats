import Link from 'next/link';
import { Badge, SectionTitle, Stars } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { BADGE_TIER_LABEL } from '@/lib/reputation-labels';

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). "Neighbour's kitchen of the week" — admin-pickable via
 * platform_config.featuredSellerId (see /admin/sellers's "⭐ Feature"
 * action). A plain server component (no client interactivity of its own) so
 * the home page doesn't pay for an extra client-side data fetch just to
 * show one already-known-server-side kitchen.
 */
export function FeaturedKitchen({
  sellerId,
  kitchenName,
  bio,
  rating,
  ratingCount,
  societyName,
  photoUrl,
  badgeTier,
}: {
  sellerId: number;
  kitchenName: string;
  bio: string | null;
  rating: number;
  ratingCount: number;
  societyName: string | null;
  photoUrl: string | null;
  badgeTier: number | null;
}) {
  return (
    <section className="mt-8">
      <SectionTitle eyebrow="ADMIN PICK · THIS WEEK" title="Neighbour's kitchen of the week" />
      <Link
        href={`/kitchen/${sellerId}`}
        className="flex items-center gap-4 overflow-hidden rounded-card border border-turmeric/40 bg-turmeric-tint p-3 transition-colors hover:border-turmeric"
      >
        <FoodImage src={photoUrl} alt={kitchenName} className="h-20 w-20 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-lg font-bold">{kitchenName}</h3>
            <span aria-hidden>🌟</span>
          </div>
          <div className="mt-0.5 text-xs text-ink-faint">{societyName}</div>
          {bio && <p className="mt-1 line-clamp-1 text-xs text-ink-soft">{bio}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Stars rating={rating} count={ratingCount} />
            {badgeTier && (
              <Badge tone="green">{BADGE_TIER_LABEL[badgeTier] ?? `🏅 ${badgeTier}+ orders`}</Badge>
            )}
          </div>
        </div>
        <span className="shrink-0 text-sm font-bold text-turmeric-deep">See menu →</span>
      </Link>
    </section>
  );
}
