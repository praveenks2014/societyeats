'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/order-status';
import { formatINR } from '@/lib/money';

type OrderRow = {
  id: number;
  type: string;
  status: string;
  totalInPaise: number;
  createdAt: string;
  vendorName: string;
  items: { titleSnapshot: string; qty: number }[];
};

export function OrdersList() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);

  useEffect(() => {
    fetch('/api/orders')
      .then((r) => r.json())
      .then((d) => setOrders(d.orders))
      .catch(() => setOrders([]));
  }, []);

  if (!orders) {
    return (
      <div className="mx-auto max-w-lg space-y-3 pt-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        emoji="🍱"
        title="No orders yet"
        body="Your first home-cooked order is a few taps away."
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
      <h1 className="text-2xl font-bold">My orders</h1>
      <div className="mt-5 space-y-3">
        {orders.map((o) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="block">
            <Card className="p-4 transition-shadow hover:shadow-lift">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{o.vendorName}</span>
                <StatusPill status={o.status} />
              </div>
              <div className="mt-1.5 truncate text-sm text-ink-soft">
                {o.items.map((i) => `${i.titleSnapshot} ×${i.qty}`).join(', ')}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
                <span>
                  #{o.id} · {o.type === 'mall_pickup' ? 'Counter pickup' : 'Home delivery'} ·{' '}
                  {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-sm font-bold text-ink">{formatINR(o.totalInPaise)}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
