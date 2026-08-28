'use client';

import { useEffect, useState } from 'react';
import { Card, EmptyState, Skeleton } from '@/components/ui';
import { formatINR } from '@/lib/money';

type Earnings = {
  totals: {
    grossPaise: number;
    commissionPaise: number;
    deliveryCollectedPaise: number;
    netPayablePaise: number;
    orderCount: number;
  };
  ledger: {
    id: number;
    createdAt: string;
    subtotalInPaise: number;
    commissionInPaise: number;
    netPaise: number;
    items: string[];
  }[];
};

export default function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);

  useEffect(() => {
    fetch('/api/seller/earnings')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;

  const { totals } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Earnings</h1>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5">
          <div className="text-lg font-bold">{formatINR(totals.grossPaise)}</div>
          <div className="text-xs text-ink-faint">Gross sales · {totals.orderCount} orders</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-lg font-bold text-chili">−{formatINR(totals.commissionPaise)}</div>
          <div className="text-xs text-ink-faint">GharSe commission</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-lg font-bold">{formatINR(totals.deliveryCollectedPaise)}</div>
          <div className="text-xs text-ink-faint">Delivery (buyer-paid, passed to riders)</div>
        </Card>
        <Card className="border-leaf p-3.5">
          <div className="text-lg font-bold text-leaf">{formatINR(totals.netPayablePaise)}</div>
          <div className="text-xs text-ink-faint">Net payable to you</div>
        </Card>
      </div>

      <Card className="mt-4 bg-leaf-tint p-4 text-sm text-leaf-dark">
        💸 <strong>Settlements:</strong> T+1 bank payouts via Razorpay Route — coming soon. This
        ledger is your source of truth until then; commission is shown on every order, never
        hidden.
      </Card>

      <h2 className="mt-8 text-lg font-bold">Ledger</h2>
      {data.ledger.length === 0 ? (
        <EmptyState emoji="🧾" title="No completed orders yet" body="Delivered orders appear here with the full commission math." />
      ) : (
        <div className="mt-3 overflow-x-auto rounded-card border border-rice-line bg-white shadow-card">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-rice-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Items</th>
                <th className="px-4 py-2.5 text-right">Gross</th>
                <th className="px-4 py-2.5 text-right">Commission</th>
                <th className="px-4 py-2.5 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((row) => (
                <tr key={row.id} className="border-b border-rice-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">#{row.id}</td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-ink-soft">
                    {row.items.join(', ')}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatINR(row.subtotalInPaise)}</td>
                  <td className="px-4 py-2.5 text-right text-chili">
                    −{formatINR(row.commissionInPaise)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-leaf">
                    {formatINR(row.netPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
