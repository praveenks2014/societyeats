'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/order-status';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type SellerOrder = {
  id: number;
  status: string;
  subtotalInPaise: number;
  commissionInPaise: number;
  createdAt: string;
  buyerName: string;
  deliveryAddressJson: { flat: string; societyName: string } | null;
  items: { id: number; titleSnapshot: string; qty: number }[];
  delivery: { provider: string; riderName: string | null; status: string } | null;
};

const NEEDS_ACTION = ['paid'];
const IN_PROGRESS = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivery_unassigned'];

export default function SellerOrders() {
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    fetch('/api/seller/orders')
      .then((r) => r.json())
      .then((d) => setOrders(d.orders))
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
    if (action === 'ready' && d.order.status === 'delivery_unassigned') {
      toast('All riders busy — admin alerted, will retry', 'err');
    } else if (action === 'ready' && d.order.type === 'home_delivery') {
      toast('Rider assigned! 🛵');
    }
    load();
  }

  if (!orders) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const needsAction = orders.filter((o) => NEEDS_ACTION.includes(o.status));
  const inProgress = orders.filter((o) => IN_PROGRESS.includes(o.status));
  const past = orders.filter((o) => !NEEDS_ACTION.includes(o.status) && !IN_PROGRESS.includes(o.status) && o.status !== 'placed');

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-bold">
          Needs action{' '}
          {needsAction.length > 0 && <Badge tone="red">{needsAction.length}</Badge>}
        </h2>
        {needsAction.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing waiting — new paid orders appear here.</p>
        ) : (
          <div className="space-y-3">
            {needsAction.map((o) => (
              <OrderCard key={o.id} order={o} busy={busyId === o.id}>
                <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'accept')}>
                  Accept
                </Button>
                <Button size="sm" variant="danger" disabled={busyId === o.id} onClick={() => act(o.id, 'reject')}>
                  Reject
                </Button>
              </OrderCard>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">In progress</h2>
        {inProgress.length === 0 ? (
          <p className="text-sm text-ink-faint">No orders being cooked right now.</p>
        ) : (
          <div className="space-y-3">
            {inProgress.map((o) => (
              <OrderCard key={o.id} order={o} busy={busyId === o.id}>
                {o.status === 'accepted' && (
                  <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'preparing')}>
                    Start cooking
                  </Button>
                )}
                {o.status === 'preparing' && (
                  <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'ready')}>
                    Mark ready → find rider
                  </Button>
                )}
                {o.delivery && ['ready', 'out_for_delivery'].includes(o.status) && (
                  <span className="text-xs text-ink-soft">
                    🛵 {o.delivery.riderName ?? 'Assigning…'} · <span className="capitalize">{o.delivery.provider}</span>
                  </span>
                )}
              </OrderCard>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Past orders</h2>
        {past.length === 0 ? (
          <EmptyState emoji="📦" title="No past orders yet" />
        ) : (
          <div className="space-y-3">
            {past.slice(0, 10).map((o) => (
              <OrderCard key={o.id} order={o} busy={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrderCard({
  order,
  busy,
  children,
}: {
  order: SellerOrder;
  busy: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className={`p-4 ${busy ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">
          #{order.id} · {order.buyerName}
        </span>
        <StatusPill status={order.status} />
      </div>
      <div className="mt-1.5 text-sm text-ink-soft">
        {order.items.map((i) => `${i.titleSnapshot} ×${i.qty}`).join(', ')}
      </div>
      {order.deliveryAddressJson && (
        <div className="mt-1 text-xs text-ink-faint">
          📍 {order.deliveryAddressJson.flat}, {order.deliveryAddressJson.societyName}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm">
          <strong>{formatINR(order.subtotalInPaise)}</strong>{' '}
          <span className="text-xs text-ink-faint">
            (−{formatINR(order.commissionInPaise)} commission)
          </span>
        </span>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </Card>
  );
}
