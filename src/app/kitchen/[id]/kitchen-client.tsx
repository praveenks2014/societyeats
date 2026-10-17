'use client';

import Link from 'next/link';
import { Badge, Card, EmptyState, SectionTitle, Stars } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { DishCard } from '@/components/dish-card';
import { ShareButton } from '@/components/share-button';
import { CartBar } from '@/components/cart-bar';
import { BADGE_TIER_LABEL } from '@/lib/reputation-labels';
import { fssaiBadge } from '@/lib/fssai/badge';

type Props = {
  seller: {
    id: number;
    kitchenName: string;
    bio: string | null;
    rating: number;
    ratingCount: number;
    fssaiStatus: 'verified' | 'pending_application' | 'unverified' | 'awaiting_admin_check';
    fssaiNumber: string | null;
    eligibleFoscosRef: string | null;
    vegOnly: boolean;
    societyName: string | null;
    kitchenPhotos: string[];
    kitchenVideoUrl: string | null;
    cookingSinceYear: number | null;
    cuisines: string[];
    orderedByCount: number;
    completedOrderCount: number;
    badgeTier: number | null;
    isFeatured: boolean;
  };
  listings: {
    id: number;
    title: string;
    priceInPaise: number;
    isVeg: boolean;
    photoUrl: string | null;
    availableQty: number;
  }[];
  reviews: {
    id: number;
    rating: number;
    text: string | null;
    buyerName: string;
    createdAt: string;
    sellerReplyText: string | null;
  }[];
};

export function KitchenProfile({ seller, listings, reviews }: Props) {
  return (
    <div className="mx-auto max-w-2xl pt-4">
      {seller.isFeatured && (
        <div className="mb-4 rounded-2xl bg-turmeric-tint px-4 py-2.5 text-center text-sm font-semibold text-turmeric-deep">
          🌟 Neighbour&apos;s kitchen of the week
        </div>
      )}

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">HOME KITCHEN</div>
            <h1 className="mt-0.5 truncate font-display text-2xl font-bold">{seller.kitchenName}</h1>
            <div className="mt-0.5 text-xs text-ink-faint">
              {seller.societyName}
              {seller.vegOnly && ' · Pure veg kitchen'}
              {seller.cookingSinceYear && ` · Cooking since ${seller.cookingSinceYear}`}
            </div>
            {seller.cuisines.length > 0 && (
              <div className="mt-0.5 text-xs text-ink-faint">{seller.cuisines.join(' · ')}</div>
            )}
          </div>
          <Stars rating={seller.rating} count={seller.ratingCount} />
        </div>

        {seller.bio && <p className="mt-3 text-sm text-ink-soft">{seller.bio}</p>}

        {seller.kitchenPhotos.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {seller.kitchenPhotos.map((url, i) => (
              <FoodImage key={i} src={url} alt="Kitchen" className="h-24 w-24 shrink-0 rounded-xl" />
            ))}
          </div>
        )}
        {seller.kitchenVideoUrl && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={seller.kitchenVideoUrl} controls className="mt-3 w-full rounded-xl bg-ink" />
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone={fssaiBadge(seller).tone}>{fssaiBadge(seller).label}</Badge>
          {seller.orderedByCount > 0 && (
            <Badge tone="neutral">Ordered by {seller.orderedByCount} neighbours</Badge>
          )}
          {seller.badgeTier && (
            <Badge tone="green">{BADGE_TIER_LABEL[seller.badgeTier] ?? `🏅 ${seller.badgeTier}+ orders`}</Badge>
          )}
        </div>

        <div className="mt-4">
          <ShareButton
            text={`Check out ${seller.kitchenName} on PadosiPlate — home-cooked food from our society 🍲`}
          />
        </div>
      </Card>

      {/* dishes */}
      <section className="mt-8">
        <SectionTitle eyebrow="ON THE MENU" title={`Dishes from ${seller.kitchenName}`} />
        {listings.length === 0 ? (
          <EmptyState emoji="🍳" title="Nothing on sale right now" body="Check back at the next meal slot." />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {listings.map((d) => (
              <DishCard
                key={d.id}
                dish={{ ...d, kitchenName: seller.kitchenName, href: `/dish/${d.id}` }}
                vendor={{ kind: 'seller', id: seller.id, name: seller.kitchenName }}
              />
            ))}
          </div>
        )}
      </section>

      {/* reviews */}
      {reviews.length > 0 && (
        <section className="mt-10">
          <SectionTitle eyebrow="FROM THE NEIGHBOURS" title={`What people say about ${seller.kitchenName}`} />
          <div className="space-y-3">
            {reviews.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{r.buyerName}</span>
                  <span className="rounded-md bg-leaf px-1.5 py-0.5 text-xs font-bold text-white">
                    ★ {r.rating}
                  </span>
                </div>
                {r.text && <p className="mt-1.5 text-sm text-ink-soft">{r.text}</p>}
                {r.sellerReplyText && (
                  <div className="mt-2 rounded-xl bg-rice-deep px-3 py-2 text-sm">
                    <span className="font-semibold">{seller.kitchenName} replied: </span>
                    {r.sellerReplyText}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 text-center">
        <Link href="/" className="text-sm font-semibold text-leaf underline">
          ← Back to browsing
        </Link>
      </div>
      <CartBar />
    </div>
  );
}
