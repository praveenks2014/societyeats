'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Modal, SectionTitle, Stars, VegDot } from '@/components/ui';
import { useCart, useToast } from '@/components/providers';
import { FoodImage } from '@/components/food-image';
import { CartBar } from '@/components/cart-bar';
import { DishCard } from '@/components/dish-card';
import { useLocation } from '@/components/providers';
import { formatINR } from '@/lib/money';
import { formatDistance, haversineKm, type GeoPoint } from '@/lib/geo';

type Props = {
  listing: {
    id: number;
    title: string;
    description: string | null;
    priceInPaise: number;
    isVeg: boolean;
    cuisine: string;
    photoUrl: string | null;
    prepTimeMins: number;
    availableQty: number;
    isActive: boolean;
    slotsJson: { days: string[]; slots: string[] } | null;
  };
  seller: {
    id: number;
    kitchenName: string;
    bio: string | null;
    rating: number;
    ratingCount: number;
    fssaiStatus: 'verified' | 'pending_application' | 'unverified';
    fssaiNumber: string | null;
    vegOnly: boolean;
    societyName: string | null;
  };
  sellerPoint: GeoPoint | null;
  radiusKm: number;
  reviews: { id: number; rating: number; text: string | null; buyerName: string; createdAt: string }[];
  otherDishes: { id: number; title: string; priceInPaise: number; isVeg: boolean; photoUrl: string | null; availableQty: number }[];
};

export function DishDetail({ listing, seller, sellerPoint, radiusKm, reviews, otherDishes }: Props) {
  const { loc, openPicker } = useLocation();
  const distanceKm = loc && sellerPoint ? haversineKm(loc, sellerPoint) : null;
  const outOfRange = distanceKm != null && distanceKm > radiusKm;
  const soldOut = listing.availableQty <= 0 || !listing.isActive;

  return (
    <div className="mx-auto max-w-2xl pt-4">
      <div className="overflow-hidden rounded-card">
        <FoodImage src={listing.photoUrl} alt={listing.title} className="aspect-[16/10] w-full" />
      </div>

      <div className="mt-4 flex items-start gap-3">
        <VegDot isVeg={listing.isVeg} className="mt-1.5" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold leading-tight">{listing.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>{listing.cuisine}</span>
            <span aria-hidden>·</span>
            <span>⏱ {listing.prepTimeMins} min prep</span>
            {distanceKm != null && (
              <>
                <span aria-hidden>·</span>
                <span className="eyebrow !text-leaf">
                  FROM {formatDistance(distanceKm).toUpperCase()} AWAY
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-right text-2xl font-bold">{formatINR(listing.priceInPaise)}</div>
      </div>

      {listing.description && (
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{listing.description}</p>
      )}

      {listing.slotsJson && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {listing.slotsJson.slots.map((s) => (
            <Badge key={s} tone="neutral" className="capitalize">
              {s}
            </Badge>
          ))}
          <Badge tone="neutral" className="capitalize">
            {listing.slotsJson.days.length === 7 ? 'Every day' : listing.slotsJson.days.join(' · ')}
          </Badge>
        </div>
      )}

      {/* kitchen card */}
      <Card className="mt-5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="eyebrow">HOME KITCHEN</div>
            <div className="mt-0.5 font-display text-lg font-bold">{seller.kitchenName}</div>
            <div className="mt-0.5 text-xs text-ink-faint">
              {seller.societyName}
              {seller.vegOnly && ' · Pure veg kitchen'}
            </div>
          </div>
          <Stars rating={seller.rating} count={seller.ratingCount} />
        </div>
        {seller.bio && <p className="mt-2 text-sm text-ink-soft">{seller.bio}</p>}
        <div className="mt-3">
          {seller.fssaiStatus === 'verified' ? (
            <Badge tone="green">FSSAI Verified ✅ · Lic. {seller.fssaiNumber}</Badge>
          ) : (
            <Badge tone="amber">FSSAI Pending — application under process</Badge>
          )}
        </div>
      </Card>

      {/* availability / range warnings */}
      {soldOut && (
        <div className="mt-4 rounded-2xl bg-chili-tint px-4 py-3 text-sm text-chili-dark">
          Sold out for today — home kitchens cook in small batches. Check back tomorrow!
        </div>
      )}
      {!soldOut && outOfRange && (
        <div className="mt-4 rounded-2xl bg-chili-tint px-4 py-3 text-sm text-chili-dark">
          This kitchen is {formatDistance(distanceKm!)} away — outside the {radiusKm} km delivery
          radius for your location.
        </div>
      )}
      {!loc && (
        <button
          onClick={openPicker}
          className="mt-4 w-full rounded-2xl border border-turmeric/50 bg-turmeric-tint px-4 py-3 text-left text-sm"
        >
          <strong>Set your location</strong> to check this kitchen is within {radiusKm} km →
        </button>
      )}

      {/* add to cart */}
      {!soldOut && !outOfRange && (
        <div className="mt-5">
          <AddButton listing={listing} seller={seller} />
          <div className="mt-1.5 text-center text-xs text-ink-faint">
            {listing.availableQty} portions left today
          </div>
        </div>
      )}

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
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* more from this kitchen */}
      {otherDishes.length > 0 && (
        <section className="mt-10">
          <SectionTitle eyebrow="SAME KITCHEN" title={`More from ${seller.kitchenName}`} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {otherDishes.map((d) => (
              <DishCard
                key={d.id}
                dish={{ ...d, kitchenName: seller.kitchenName, href: `/dish/${d.id}` }}
                vendor={{ kind: 'seller', id: seller.id, name: seller.kitchenName }}
              />
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

function AddButton({ listing, seller }: { listing: Props['listing']; seller: Props['seller'] }) {
  return (
    <DishAddInner
      dish={{
        id: listing.id,
        title: listing.title,
        priceInPaise: listing.priceInPaise,
        isVeg: listing.isVeg,
        photoUrl: listing.photoUrl,
        availableQty: listing.availableQty,
        kitchenName: seller.kitchenName,
      }}
      sellerId={seller.id}
      kitchenName={seller.kitchenName}
    />
  );
}

function DishAddInner({
  dish,
  sellerId,
  kitchenName,
}: {
  dish: { id: number; title: string; priceInPaise: number; isVeg: boolean; photoUrl: string | null; availableQty: number; kitchenName: string };
  sellerId: number;
  kitchenName: string;
}) {
  const { add, replaceWith, vendor: cartVendor, items, inc, dec } = useCart();
  const toast = useToast();
  const [conflict, setConflict] = useState(false);
  const vendor = { kind: 'seller' as const, id: sellerId, name: kitchenName };
  const item = {
    id: dish.id,
    title: dish.title,
    pricePaise: dish.priceInPaise,
    isVeg: dish.isVeg,
    photoUrl: dish.photoUrl,
    maxQty: dish.availableQty,
  };
  const inCart = items.find((i) => i.id === dish.id && cartVendor?.kind === 'seller' && cartVendor.id === sellerId);

  if (inCart) {
    return (
      <div className="flex items-center justify-center gap-4 rounded-xl border-2 border-leaf py-2">
        <button onClick={() => dec(dish.id)} className="px-4 text-xl font-bold text-leaf" aria-label="Remove one">
          −
        </button>
        <span className="min-w-8 text-center text-lg font-bold">{inCart.qty}</span>
        <button onClick={() => inc(dish.id)} className="px-4 text-xl font-bold text-leaf" aria-label="Add one">
          +
        </button>
      </div>
    );
  }

  return (
    <>
      <BigAdd
        onClick={() => {
          const result = add(vendor, item);
          if (result === 'conflict') setConflict(true);
          else toast(`Added ${dish.title}`);
        }}
      />
      <Modal open={conflict} onClose={() => setConflict(false)} title="Start a new basket?" sheet>
        <p className="text-sm text-ink-soft">
          Your basket has items from <strong>{cartVendor?.name}</strong>. Replace it with items
          from <strong>{kitchenName}</strong>?
        </p>
        <div className="mt-5 flex gap-3">
          <BigGhost onClick={() => setConflict(false)}>Keep basket</BigGhost>
          <BigAdd
            label="Replace"
            onClick={() => {
              replaceWith(vendor, item);
              setConflict(false);
            }}
          />
        </div>
      </Modal>
    </>
  );
}

function BigAdd({ onClick, label = 'Add to basket' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl bg-turmeric py-3 text-base font-bold text-ink shadow-card transition-transform active:scale-[0.98]"
    >
      {label}
    </button>
  );
}

function BigGhost({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full rounded-xl border border-rice-line py-3 text-base font-semibold text-ink-soft">
      {children}
    </button>
  );
}
