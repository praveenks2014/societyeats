'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, Select, Skeleton } from '@/components/ui';
import { DisclaimerClient } from '@/components/disclaimer-client';
import { formatINR } from '@/lib/money';
import { BRAND } from '@/config/brand';

type Data = {
  fy: { label: string; startYear: number };
  currentFyStartYear: number;
  months: { month: string; foodPaise: number; orders: number }[];
  totals: { foodPaise: number; orders: number };
  cancellations: { seller_declined: number; seller_cancelled: number; kitchen_missed: number; buyer: number; buyer_unpaid_or_no_show: number };
  acceptance: { windowDays: number; rate: number | null; accepted: number; declined: number; missed: number };
  tds: { fySalesPaise: number; warnPaise: number; pausePaise: number; level: 'ok' | 'warn' | 'paused' };
  ratings: { rating: number; count: number };
};
type Plan = { status: string; daysLeft: number | null; endsAt: string | null };

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (k: string) => `${MONTH[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;

/** The kitchen's own sales record. Buyers pay the kitchen directly, so this is for your books, not money held by Kootu. */
export default function SalesPage() {
  const [fy, setFy] = useState<number | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    fetch(`/api/seller/earnings${fy ? `?fy=${fy}` : ''}`).then((r) => r.json()).then(setData).catch(() => {});
  }, [fy]);
  useEffect(() => {
    fetch('/api/seller/summary').then((r) => r.json()).then((d) => setPlan(d.subscription)).catch(() => {});
  }, []);
  if (!data) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  const { totals, tds, acceptance, cancellations: c } = data;
  const pct = tds.pausePaise > 0 ? Math.min(100, Math.round((tds.fySalesPaise / tds.pausePaise) * 100)) : 0;
  const years = Array.from({ length: data.currentFyStartYear - 2025 + 1 }, (_, i) => data.currentFyStartYear - i);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Sales</h1>
        <p className="mt-1 text-sm text-ink-soft">Buyers pay you directly at their door, so this is a record for <em>your</em> books. {BRAND.name} holds none of your food money and takes no cut of it. Your costs are the subscription and the platform fee buyers pay on top.</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Select value={String(data.fy.startYear)} onChange={(e) => setFy(Number(e.target.value))} aria-label="Financial year" data-testid="fy-select" className="max-w-[12rem]">
          {years.map((y) => <option key={y} value={y}>FY {y}-{String((y + 1) % 100).padStart(2, '0')}</option>)}
        </Select>
        <a href={`/api/seller/earnings/export?fy=${data.fy.startYear}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-leaf underline" data-testid="export-csv">Download CSV</a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5"><div className="text-lg font-bold" data-testid="fy-total">{formatINR(totals.foodPaise)}</div><div className="text-xs text-ink-faint">Food sales · paid directly to you</div></Card>
        <Card className="p-3.5"><div className="text-lg font-bold">{totals.orders}</div><div className="text-xs text-ink-faint">Completed orders</div></Card>
        <Card className="p-3.5"><div className="text-lg font-bold" data-testid="acceptance-rate">{acceptance.rate == null ? '–' : `${acceptance.rate}%`}</div><div className="text-xs text-ink-faint">Accepted, last {acceptance.windowDays} days</div></Card>
        <Card className="p-3.5"><div className="text-lg font-bold">{data.ratings.count ? `★ ${data.ratings.rating.toFixed(1)}` : '–'}</div><div className="text-xs text-ink-faint">{data.ratings.count} ratings</div></Card>
      </div>

      {data.fy.startYear === data.currentFyStartYear && (
        <Card className="p-4" data-testid="tds-card" data-level={tds.level}>
          <div className="flex items-center justify-between">
            <div className="eyebrow">THIS FINANCIAL YEAR · TAX LIMITS</div>
            {tds.level !== 'ok' && <Badge tone={tds.level === 'paused' ? 'red' : 'amber'}>{tds.level === 'paused' ? 'New orders paused' : 'Close to the limit'}</Badge>}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-pill bg-rice-deep" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${tds.level === 'ok' ? 'bg-leaf' : tds.level === 'warn' ? 'bg-turmeric' : 'bg-chili'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-soft">{formatINR(tds.fySalesPaise)} sold. You will be warned at {formatINR(tds.warnPaise)} and new orders pause at {formatINR(tds.pausePaise)} until {BRAND.name} has spoken to you about tax.</p>
        </Card>
      )}

      <Card className="p-4">
        <div className="eyebrow">BY MONTH</div>
        <table className="mt-2 w-full text-sm" data-testid="month-table">
          <thead><tr className="text-left text-xs text-ink-faint"><th className="py-1">Month</th><th className="py-1 text-right">Orders</th><th className="py-1 text-right">Food sales</th></tr></thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month} className="border-t border-rice-line"><td className="py-1.5">{monthLabel(m.month)}</td><td className="py-1.5 text-right">{m.orders}</td><td className="py-1.5 text-right">{formatINR(m.foodPaise)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4" data-testid="cancellations">
        <div className="eyebrow">CANCELLATIONS THIS YEAR</div>
        <ul className="mt-2 space-y-1 text-sm">
          <li className="flex justify-between"><span>You declined a booked order</span><strong>{c.seller_declined}</strong></li>
          <li className="flex justify-between"><span>You cancelled after accepting</span><strong>{c.seller_cancelled}</strong></li>
          <li className="flex justify-between"><span>Not accepted in time</span><strong>{c.kitchen_missed}</strong></li>
          <li className="flex justify-between"><span>Buyer cancelled</span><strong>{c.buyer}</strong></li>
          <li className="flex justify-between"><span>Buyer could not pay or was not there</span><strong>{c.buyer_unpaid_or_no_show}</strong></li>
        </ul>
      </Card>

      {plan && (
        <Card className="p-4" data-testid="plan-card">
          <div className="eyebrow">YOUR PLAN</div>
          <p className="mt-1 text-sm">{plan.status === 'waived' ? 'Founding kitchen: free' : plan.status}{plan.daysLeft != null ? ` · ${plan.daysLeft} day(s) left` : ''}</p>
        </Card>
      )}

      <DisclaimerClient id="tax-seller" />
    </div>
  );
}
