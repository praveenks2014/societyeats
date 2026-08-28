'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, VegDot } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useCart } from '@/components/providers';
import { formatINR } from '@/lib/money';

export default function CartPage() {
  const { vendor, items, subtotalPaise, inc, dec, clear } = useCart();
  const router = useRouter();

  if (items.length === 0) {
    return (
      <EmptyState
        emoji="🧺"
        title="Your basket is empty"
        body="Find something delicious from a kitchen near you."
        action={
          <Link href="/">
            <Button>Browse food</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-lg pt-6">
      <div className="eyebrow">YOUR BASKET FROM</div>
      <h1 className="mt-1 text-2xl font-bold">{vendor?.name}</h1>
      {vendor?.kind === 'restaurant' && vendor.counterNumber && (
        <p className="text-sm text-ink-soft">Counter {vendor.counterNumber} · pickup order</p>
      )}

      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-card border border-rice-line bg-white p-3 shadow-card">
            <FoodImage src={item.photoUrl} alt="" className="h-16 w-16 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <VegDot isVeg={item.isVeg} />
                <span className="truncate text-sm font-semibold">{item.title}</span>
              </div>
              <div className="mt-0.5 text-sm text-ink-soft">{formatINR(item.pricePaise)}</div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-leaf px-1">
              <button onClick={() => dec(item.id)} className="px-2 py-1 text-lg font-bold text-leaf" aria-label={`Remove one ${item.title}`}>
                −
              </button>
              <span className="min-w-5 text-center text-sm font-bold">{item.qty}</span>
              <button
                onClick={() => inc(item.id)}
                className="px-2 py-1 text-lg font-bold text-leaf disabled:opacity-30"
                disabled={item.qty >= item.maxQty}
                aria-label={`Add one ${item.title}`}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-card border border-rice-line bg-white p-4 shadow-card">
        <div className="flex justify-between text-sm">
          <span>Item total</span>
          <span className="font-semibold">{formatINR(subtotalPaise)}</span>
        </div>
        <div className="mt-1 flex justify-between text-xs text-ink-faint">
          <span>{vendor?.kind === 'restaurant' ? 'No delivery fee — counter pickup' : 'Delivery fee & final bill at checkout'}</span>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <Button variant="ghost" onClick={clear}>
          Clear
        </Button>
        <Button size="lg" className="flex-1" onClick={() => router.push('/checkout')}>
          Checkout · {formatINR(subtotalPaise)}
        </Button>
      </div>
    </div>
  );
}
