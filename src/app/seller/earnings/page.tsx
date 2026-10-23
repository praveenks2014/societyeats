'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, EmptyState, Skeleton } from '@/components/ui';
import { formatINR } from '@/lib/money';

type Sales = {
  totals: { foodReceivedPaise: number; viaUpiPaise: number; atHandoverPaise: number; orderCount: number; refundsDueCount: number; refundsDuePaise: number };
  ledger: { id: number; completedAt: string | null; foodTotalInPaise: number; mode: string | null; items: string[] }[];
};

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—');

export default function SalesPage() {
  const [data, setData] = useState<Sales | null>(null);
  useEffect(() => {
    fetch('/api/seller/earnings').then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  if (!data) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  const { totals } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Sales</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Buyers pay you directly (UPI or at pickup), so this is a record for <em>your</em> books — PadosiPlate holds no money for you and takes no cut of food sales. Your only costs are the subscription and the platform fee buyers pay on top.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5">
          <div className="text-lg font-bold">{formatINR(totals.foodReceivedPaise)}</div>
          <div className="text-xs text-ink-faint">Food sales · {totals.orderCount} orders</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-lg font-bold">{formatINR(totals.viaUpiPaise)}</div>
          <div className="text-xs text-ink-faint">Received by UPI</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-lg font-bold">{formatINR(totals.atHandoverPaise)}</div>
          <div className="text-xs text-ink-faint">Paid at pickup</div>
        </Card>
        <Link href="/seller/refunds-due">
          <Card className={`p-3.5 ${totals.refundsDueCount ? 'border-chili/40' : ''}`}>
            <div className={`text-lg font-bold ${totals.refundsDueCount ? 'text-chili' : ''}`}>{formatINR(totals.refundsDuePaise)}</div>
            <div className="text-xs text-ink-faint">Refunds you owe ({totals.refundsDueCount})</div>
          </Card>
        </Link>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-bold">Recent completed orders</h2>
      {data.ledger.length === 0 ? (
        <EmptyState emoji="🧾" title="No completed orders yet" />
      ) : (
        <div className="space-y-2">
          {data.ledger.map((l) => (
            <Card key={l.id} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-semibold">#{l.id} · {fmtDate(l.completedAt)}</div>
                <div className="truncate text-xs text-ink-faint">{l.items.join(', ')}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-bold">{formatINR(l.foodTotalInPaise)}</div>
                <div className="text-[11px] text-ink-faint">{l.mode === 'upi_now' ? 'UPI' : 'at pickup'}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
