'use client';

import { Badge, EmptyState, SectionTitle } from '@/components/ui';
import { DishCard } from '@/components/dish-card';
import { CartBar } from '@/components/cart-bar';

type MallProps = {
  mall: { name: string; city: string; slug: string };
  restaurants: {
    id: number;
    name: string;
    counterNumber: string;
    fssaiNumber: string | null;
    items: {
      id: number;
      title: string;
      priceInPaise: number;
      isVeg: boolean;
      photoUrl: string | null;
      stockQty: number;
    }[];
  }[];
};

/**
 * QR landing page — scanned at mall entrances / food-court tables.
 * Browse without login; login happens at checkout.
 */
export function MallClient({ mall, restaurants }: MallProps) {
  return (
    <div>
      <section className="-mx-4 mb-6 bg-gradient-to-br from-leaf-dark via-leaf to-leaf-soft px-4 py-10 text-rice sm:-mx-6 sm:rounded-b-[2rem] sm:px-6">
        <div className="eyebrow !text-turmeric">MALL MODE · ORDER AHEAD</div>
        <h1 className="mt-1 text-3xl font-bold">{mall.name}</h1>
        <p className="mt-2 max-w-md text-sm text-rice/80">
          Skip the food-court queue: pay now, cook starts immediately, and we ping you the moment
          your order is ready at the counter. No login needed to browse.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-pill bg-white/15 px-3 py-1">1 · Pick dishes</span>
          <span className="rounded-pill bg-white/15 px-3 py-1">2 · Pay online</span>
          <span className="rounded-pill bg-white/15 px-3 py-1">3 · Collect with OTP</span>
        </div>
      </section>

      {restaurants.length === 0 ? (
        <EmptyState emoji="🏬" title="No counters live right now" />
      ) : (
        restaurants.map((r) => (
          <section key={r.id} className="mb-10">
            <SectionTitle
              eyebrow={`COUNTER ${r.counterNumber}${r.fssaiNumber ? ` · FSSAI ${r.fssaiNumber}` : ''}`}
              title={r.name}
            />
            {r.items.length === 0 ? (
              <p className="text-sm text-ink-faint">Sold out — check back soon.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {r.items.map((item) => (
                  <DishCard
                    key={item.id}
                    dish={{
                      id: item.id,
                      title: item.title,
                      priceInPaise: item.priceInPaise,
                      isVeg: item.isVeg,
                      photoUrl: item.photoUrl,
                      availableQty: item.stockQty,
                      kitchenName: r.name,
                    }}
                    vendor={{
                      kind: 'restaurant',
                      id: r.id,
                      name: r.name,
                      mallSlug: mall.slug,
                      counterNumber: r.counterNumber,
                    }}
                    requireLocation={false}
                  />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      <div className="mb-4 rounded-2xl bg-rice-deep px-4 py-3 text-xs text-ink-soft">
        <Badge tone="neutral" className="mr-2">ℹ️</Badge>
        Every counter displays its FSSAI license. Pickup orders carry a {`6%`} platform commission
        paid by the restaurant — your bill has no hidden fees.
      </div>
      <CartBar />
    </div>
  );
}
