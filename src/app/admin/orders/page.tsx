'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/order-status';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Row = {
  id: number;
  type: string;
  status: string;
  totalInPaise: number;
  commissionInPaise: number;
  createdAt: string;
  buyerName: string;
  vendorName: string;
  payment: { status: string; method: string | null } | null;
  delivery: { provider: string; status: string; riderName: string | null } | null;
};

export default function AdminOrders() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/admin/orders')
      .then((r) => r.json())
      .then((d) => setRows(d.orders))
      .catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  async function retry(id: number) {
    setBusyId(id);
    const res = await fetch(`/api/admin/orders/${id}/retry`, { method: 'POST' });
    const d = await res.json();
    setBusyId(null);
    if (!res.ok) {
      toast(d.error || 'Retry failed', 'err');
      return;
    }
    toast(d.order.status === 'delivery_unassigned' ? 'Still no riders — try re-enabling a provider' : 'Rider found 🛵');
    load();
  }

  if (!rows) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
      <h1 className="text-2xl font-bold">All orders</h1>
      <div className="mt-5 overflow-x-auto rounded-card border border-rice-line bg-white shadow-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-rice-line text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Buyer → Vendor</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Payment</th>
              <th className="px-3 py-2.5">Delivery</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-rice-line align-top last:border-0">
                <td className="px-3 py-2.5 font-medium">{o.id}</td>
                <td className="px-3 py-2.5">
                  <div>{o.buyerName}</div>
                  <div className="text-xs text-ink-faint">→ {o.vendorName}</div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusPill status={o.status} />
                  {o.status === 'delivery_unassigned' && (
                    <Button size="sm" className="mt-1.5" loading={busyId === o.id} onClick={() => retry(o.id)}>
                      Retry dispatch
                    </Button>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {o.payment ? (
                    <Badge tone={o.payment.status === 'captured' ? 'green' : o.payment.status === 'refunded' ? 'red' : 'neutral'}>
                      {o.payment.status}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {o.delivery ? (
                    <>
                      <span className="capitalize">{o.delivery.provider}</span>
                      <div className="text-ink-faint">{o.delivery.riderName ?? '—'}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">{formatINR(o.totalInPaise)}</td>
                <td className="px-3 py-2.5 text-right text-leaf">{formatINR(o.commissionInPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
