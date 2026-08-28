'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, EmptyState, Input, SectionTitle, Skeleton } from '@/components/ui';
import { DishCard } from '@/components/dish-card';
import { CartBar } from '@/components/cart-bar';
import { useLocation } from '@/components/providers';
import type { ListingCard } from '@/lib/browse';

export function Browse() {
  const { loc, openPicker } = useLocation();
  const [data, setData] = useState<{ listings: ListingCard[]; cuisines: string[]; radiusKm: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [veg, setVeg] = useState(false);
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (loc) {
      params.set('lat', String(loc.lat));
      params.set('lng', String(loc.lng));
    }
    if (veg) params.set('veg', '1');
    if (cuisine) params.set('cuisine', cuisine);
    if (qDebounced) params.set('q', qDebounced);
    fetch(`/api/listings?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [loc, veg, cuisine, qDebounced]);

  const cuisines = useMemo(() => data?.cuisines ?? [], [data]);

  return (
    <section id="browse">
      {/* sticky search + filters */}
      <div className="sticky top-14 z-30 -mx-4 bg-rice/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search biryani, tiffins, kitchens…"
            aria-label="Search dishes"
          />
          <Chip active={veg} onClick={() => setVeg((v) => !v)}>
            🟢 Veg
          </Chip>
        </div>
        {cuisines.length > 0 && (
          <div className="no-scrollbar -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Chip active={!cuisine} onClick={() => setCuisine(null)}>
              All
            </Chip>
            {cuisines.map((c) => (
              <Chip key={c} active={cuisine === c} onClick={() => setCuisine(cuisine === c ? null : c)}>
                {c}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        <SectionTitle
          eyebrow={loc ? `WITHIN ${data?.radiusKm ?? 10} KM OF ${loc.label.toUpperCase()}` : 'ACROSS ALL SOCIETIES'}
          title="Cooking near you today"
        />

        {!loc && (
          <button
            onClick={openPicker}
            className="mb-5 flex w-full items-center justify-between rounded-2xl border border-turmeric/50 bg-turmeric-tint px-4 py-3 text-left text-sm"
          >
            <span>
              <strong>Set your location</strong> to see distances and order from kitchens within{' '}
              {data?.radiusKm ?? 10} km.
            </span>
            <span className="shrink-0 font-bold text-turmeric-deep">Choose →</span>
          </button>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-card">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="space-y-2 bg-white p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : !data || data.listings.length === 0 ? (
          <EmptyState
            emoji="🍳"
            title="No kitchens match"
            body={
              loc
                ? 'Try clearing filters — or check back at meal time, home kitchens list in small batches.'
                : 'Try clearing your filters.'
            }
            action={
              (veg || cuisine || q) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setVeg(false);
                    setCuisine(null);
                    setQ('');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data.listings.map((dish) => (
              <DishCard
                key={dish.id}
                dish={{ ...dish, href: `/dish/${dish.id}` }}
                vendor={{ kind: 'seller', id: dish.sellerId, name: dish.kitchenName }}
              />
            ))}
          </div>
        )}
      </div>
      <CartBar />
    </section>
  );
}
