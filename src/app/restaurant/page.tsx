'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/order-status';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type RestOrder = {
  id: number;
  status: string;
  subtotalInPaise: number;
  createdAt: string;
  buyerName: string;
  items: { id: number; titleSnapshot: string; qty: number }[];
};

export default function RestaurantQueue() {
  const [data, setData] = useState<{ restaurant: { name: string; counterNumber: string }; orders: RestOrder[] } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [otps, setOtps] = useState<Record<number, string>>({});
  const toast = useToast();

  const load = useCallback(() => {
    fetch('/api/restaurant/orders')
      .then((r) => r.json())
      .then((d) => !d.error && setData(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: number, action: string) {
    setBusyId(id);
    const res = await fetch(`/api/orders/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const d = await res.json();
    setBusyId(null);
    if (!res.ok) {
      toast(d.error || 'Could not update', 'err');
      return;
    }
    if (action === 'ready') toast('Buyer notified — order ready 🔔');
    load();
  }

  async function verifyOtp(id: number) {
    setBusyId(id);
    const res = await fetch(`/api/orders/${id}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: otps[id] }),
    });
    const d = await res.json();
    setBusyId(null);
    if (!res.ok) {
      toast(d.error || 'Wrong OTP', 'err');
      return;
    }
    toast('Handover complete 🛍️');
    load();
  }

  if (!data) return <Skeleton className="h-64 w-full" />;

  const groups: { title: string; filter: (o: RestOrder) => boolean; render: (o: RestOrder) => React.ReactNode }[] = [
    {
      title: '🆕 New — accept to start',
      filter: (o) => o.status === 'paid',
      render: (o) => (
        <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'accept')}>
          Received — start
        </Button>
      ),
    },
    {
      title: '🍳 Preparing',
      filter: (o) => ['accepted', 'preparing'].includes(o.status),
      render: (o) =>
        o.status === 'accepted' ? (
          <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'preparing')}>
            Cooking
          </Button>
        ) : (
          <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'ready')}>
            Mark ready 🔔
          </Button>
        ),
    },
    {
      title: '🛎️ Ready — verify buyer OTP at handover',
      filter: (o) => o.status === 'ready',
      render: (o) => (
        <div className="flex gap-2">
          <Input
            className="!w-28"
            inputMode="numeric"
            maxLength={4}
            placeholder="OTP"
            value={otps[o.id] ?? ''}
            onChange={(e) => setOtps((p) => ({ ...p, [o.id]: e.target.value.replace(/\D/g, '') }))}
          />
          <Button size="sm" loading={busyId === o.id} disabled={(otps[o.id] ?? '').length !== 4} onClick={() => verifyOtp(o.id)}>
            Hand over
          </Button>
        </div>
      ),
    },
  ];

  const past = data.orders.filter((o) => ['picked_up', 'cancelled', 'refund_pending'].includes(o.status));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">{data.restaurant.name}</h1>
      <p className="text-sm text-ink-soft">Counter {data.restaurant.counterNumber} · order-ahead pickup</p>

      {groups.map((g) => {
        const rows = data.orders.filter(g.filter);
        return (
          <section key={g.title} className="mt-7">
            <h2 className="mb-3 text-base font-bold">
              {g.title} {rows.length > 0 && <Badge tone="amber">{rows.length}</Badge>}
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm text-ink-faint">Empty.</p>
            ) : (
              <div className="space-y-3">
                {rows.map((o) => (
                  <Card key={o.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">#{o.id} · {o.buyerName}</span>
                      <StatusPill status={o.status} />
                    </div>
                    <div className="mt-1 text-sm text-ink-soft">
                      {o.items.map((i) => `${i.titleSnapshot} ×${i.qty}`).join(', ')}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-sm font-bold">{formatINR(o.subtotalInPaise)}</span>
                      {g.render(o)}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <section className="mt-7">
        <h2 className="mb-3 text-base font-bold">Done today</h2>
        {past.length === 0 ? (
          <EmptyState emoji="🧾" title="Nothing yet" />
        ) : (
          <div className="space-y-2">
            {past.slice(0, 8).map((o) => (
              <Card key={o.id} className="flex items-center justify-between p-3 text-sm">
                <span>#{o.id} · {o.items.map((i) => `${i.titleSnapshot} ×${i.qty}`).join(', ')}</span>
                <StatusPill status={o.status} />
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
