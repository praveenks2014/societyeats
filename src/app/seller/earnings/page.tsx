'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui';
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

type Payout = {
  id: number;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  grossSalesInPaise: number;
  commissionInPaise: number;
  gatewayFeeEstimateInPaise: number;
  tds194OInPaise: number;
  refundDeductionInPaise: number;
  netPayableInPaise: number;
  status: 'pending' | 'paid';
  paidAt: string | null;
  utrReference: string | null;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [payouts, setPayouts] = useState<Payout[] | null>(null);

  useEffect(() => {
    fetch('/api/seller/earnings')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
    fetch('/api/seller/payouts')
      .then((r) => r.json())
      .then((d) => setPayouts(d.payouts))
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
          <div className="text-xs text-ink-faint">PadosiPlate commission</div>
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
        💸 <strong>Payout schedule:</strong> Paid every day for orders completed 2 days earlier.
        PadosiPlate is the merchant of record — commission, an estimated payment-gateway fee, and (once
        you cross ₹5,00,000 in a financial year) 0.1% TDS under Sec 194-O are shown on every payout
        before the net amount reaches your bank/UPI. This ledger and the payouts below are your
        source of truth; nothing is ever hidden.
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

      <h2 className="mt-8 text-lg font-bold">Payouts</h2>
      {!payouts ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : payouts.length === 0 ? (
        <EmptyState
          emoji="🏦"
          title="No payouts yet"
          body="Orders join a payout batch once completed for 48 hours — check back after your first couple of deliveries."
        />
      ) : (
        <div className="mt-3 space-y-3">
          {payouts.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">
                    {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {p.orderCount} order{p.orderCount === 1 ? '' : 's'}
                  </div>
                </div>
                {p.status === 'paid' ? (
                  <Badge tone="green">Paid{p.utrReference ? ` · ${p.utrReference}` : ''}</Badge>
                ) : (
                  <Badge tone="amber">Processing</Badge>
                )}
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-soft">Gross sales</span>
                  <span>{formatINR(p.grossSalesInPaise)}</span>
                </div>
                <div className="flex justify-between text-chili">
                  <span>Commission</span>
                  <span>−{formatINR(p.commissionInPaise)}</span>
                </div>
                <div className="flex justify-between text-chili">
                  <span>Gateway fee (est.)</span>
                  <span>−{formatINR(p.gatewayFeeEstimateInPaise)}</span>
                </div>
                {p.tds194OInPaise > 0 && (
                  <div className="flex justify-between text-chili">
                    <span>TDS (Sec 194-O)</span>
                    <span>−{formatINR(p.tds194OInPaise)}</span>
                  </div>
                )}
                {p.refundDeductionInPaise > 0 && (
                  <div className="flex justify-between text-chili">
                    <span>Refund deduction</span>
                    <span>−{formatINR(p.refundDeductionInPaise)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-dashed border-rice-line pt-1 text-base font-bold text-leaf">
                  <span>Net payable</span>
                  <span>{formatINR(p.netPayableInPaise)}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
