'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Skeleton } from '@/components/ui';
import { formatINR } from '@/lib/money';

type Report = {
  range: string;
  fee: { orders: number; grossPaise: number; gstPaise: number; ecoGstPaise: number; netPaise: number };
  subscriptions: { count: number; grossPaise: number; gstPaise: number; netPaise: number };
  refunds: { count: number; platformFeePaise: number; subscriptionPaise: number };
  totalNetRevenuePaise: number;
  subscriptionStatus: { active: number; waived: number; grace: number; expired: number; none: number };
  expiringIn7Days: number;
  ordersByFoodPaymentMode: Record<string, number>;
  unconfirmedKitchenPayments: number;
  outstandingKitchenRefunds: { count: number; totalPaise: number };
};

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

export default function RevenuePage() {
  const [range, setRange] = useState('7d');
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    setR(null);
    fetch(`/api/admin/revenue?range=${range}`).then((x) => x.json()).then(setR).catch(() => {});
  }, [range]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Revenue</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-pill bg-rice-deep p-1" role="tablist">
            {RANGES.map((x) => (
              <button key={x.key} role="tab" aria-selected={range === x.key} onClick={() => setRange(x.key)} className={`min-h-[40px] rounded-pill px-4 text-sm font-semibold ${range === x.key ? 'bg-white shadow-card' : 'text-ink-soft'}`}>
                {x.label}
              </button>
            ))}
          </div>
          <a href={`/api/admin/revenue?range=${range}&format=csv`}><Button variant="secondary" size="sm">⬇ CSV</Button></a>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-soft">PadosiPlate’s own revenue only: buyer platform fees and kitchen subscriptions. Food money goes straight to kitchens and is not shown here.</p>

      {!r ? (
        <Skeleton className="mt-5 h-64 w-full" />
      ) : (
        <>
          <Card className="mt-5 p-4" data-testid="net-revenue">
            <div className="eyebrow">NET REVENUE (EX-GST, AFTER SUBSCRIPTION REFUNDS)</div>
            <div className="mt-1 text-3xl font-bold">{formatINR(r.totalNetRevenuePaise)}</div>
          </Card>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <div className="eyebrow">BUYER PLATFORM FEES · {r.fee.orders} orders</div>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="Gross collected" v={formatINR(r.fee.grossPaise)} />
                <Row k="GST on fee" v={formatINR(r.fee.gstPaise)} />
                <Row k="ECO food GST" v={formatINR(r.fee.ecoGstPaise)} />
                <Row k="Net" v={formatINR(r.fee.netPaise)} bold />
              </dl>
            </Card>
            <Card className="p-4">
              <div className="eyebrow">KITCHEN SUBSCRIPTIONS · {r.subscriptions.count} paid</div>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="Gross collected" v={formatINR(r.subscriptions.grossPaise)} />
                <Row k="GST" v={formatINR(r.subscriptions.gstPaise)} />
                <Row k="Net" v={formatINR(r.subscriptions.netPaise)} bold />
              </dl>
            </Card>
            <Card className="p-4">
              <div className="eyebrow">REFUNDS · {r.refunds.count}</div>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="Platform fee refunded" v={formatINR(r.refunds.platformFeePaise)} />
                <Row k="Subscriptions refunded" v={formatINR(r.refunds.subscriptionPaise)} />
              </dl>
            </Card>
            <Card className="p-4">
              <div className="eyebrow">KITCHEN SUBSCRIPTIONS NOW</div>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="Active (incl. complimentary)" v={String(r.subscriptionStatus.active + r.subscriptionStatus.waived)} />
                <Row k="In grace" v={String(r.subscriptionStatus.grace)} />
                <Row k="Expired" v={String(r.subscriptionStatus.expired)} />
                <Row k="Expiring in 7 days" v={String(r.expiringIn7Days)} />
              </dl>
            </Card>
            <Card className="p-4">
              <div className="eyebrow">ORDERS BY FOOD PAYMENT</div>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="UPI now" v={String(r.ordersByFoodPaymentMode.upi_now ?? 0)} />
                <Row k="Pay at pickup" v={String(r.ordersByFoodPaymentMode.pay_at_pickup ?? 0)} />
              </dl>
            </Card>
            <Card className={`p-4 ${r.unconfirmedKitchenPayments || r.outstandingKitchenRefunds.count ? 'border-chili/40' : ''}`}>
              <div className="eyebrow">NEEDS ATTENTION</div>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="Unconfirmed kitchen payments" v={String(r.unconfirmedKitchenPayments)} />
                <Row k="Outstanding kitchen refunds" v={`${r.outstandingKitchenRefunds.count} · ${formatINR(r.outstandingKitchenRefunds.totalPaise)}`} />
              </dl>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'border-t border-rice-line pt-1 font-bold' : ''}`}>
      <dt className="text-ink-soft">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
