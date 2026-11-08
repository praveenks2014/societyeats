'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';
import type { Overview, OverviewResult } from '@/lib/metrics-overview';
import { BRAND } from '@/config/brand';

const EXPORTS: { kind: string; label: string }[] = [
  { kind: 'fee_invoices', label: 'Fee invoice register' },
  { kind: 'food_gst', label: 'Food GST register (Sec 9(5))' },
  { kind: 'tds', label: 'TDS report (by financial year)' },
  { kind: 'consents', label: 'Consent log' },
  { kind: 'audit_log', label: 'Admin audit log' },
  { kind: 'orders', label: 'Orders' },
];
const v = (n: number | null, suffix = '') => (n == null ? '–' : `${n}${suffix}`);

function Block({ m, id }: { m: Overview; id: string }) {
  const f = m.buyerFunnel;
  const k = m.kitchenFunnel;
  const q = m.quality;
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid={`block-${id}`}>
      <Card className="p-4">
        <div className="eyebrow">BUYER FUNNEL</div>
        <ol className="mt-2 space-y-1 text-sm">
          <li className="flex justify-between"><span>Visits</span><strong>{f.visits}</strong></li>
          <li className="flex justify-between"><span>Sign-ups</span><strong>{f.signUps}</strong></li>
          <li className="flex justify-between"><span>Email verified</span><strong>{f.verified}</strong></li>
          <li className="flex justify-between"><span>First order</span><strong>{f.firstOrder}</strong></li>
          <li className="flex justify-between"><span>Repeat (2+ orders)</span><strong>{f.repeat}</strong></li>
        </ol>
      </Card>
      <Card className="p-4">
        <div className="eyebrow">KITCHEN FUNNEL</div>
        <ol className="mt-2 space-y-1 text-sm">
          <li className="flex justify-between"><span>Applied</span><strong>{k.applied}</strong></li>
          <li className="flex justify-between"><span>UPI verified</span><strong>{k.upiVerified}</strong></li>
          <li className="flex justify-between"><span>FSSAI: verified / provisional / applied</span><strong>{k.fssai.verified} / {k.fssai.provisional} / {k.fssai.applied}</strong></li>
          <li className="flex justify-between"><span>Approved</span><strong>{k.approved}</strong></li>
          <li className="flex justify-between"><span>Had an order</span><strong>{k.firstOrder}</strong></li>
        </ol>
      </Card>
      <Card className="p-4">
        <div className="eyebrow">MONEY</div>
        <ul className="mt-2 space-y-1 text-sm">
          <li className="flex justify-between"><span>GMV (food, completed)</span><strong>{formatINR(m.money.gmvPaise)}</strong></li>
          <li className="flex justify-between"><span>Platform fee kept</span><strong>{formatINR(m.money.feeRevenuePaise)}</strong></li>
          <li className="flex justify-between"><span>Fees refunded</span><strong>{formatINR(m.money.refundsPaise)}</strong></li>
          <li className="flex justify-between"><span>Credits issued</span><strong>{formatINR(m.money.creditsIssuedPaise)}</strong></li>
          <li className="flex justify-between"><span>Plan revenue</span><strong>{formatINR(m.money.planRevenuePaise)}</strong></li>
        </ul>
      </Card>
      <Card className="p-4">
        <div className="eyebrow">QUALITY</div>
        <ul className="mt-2 space-y-1 text-sm">
          <li className="flex justify-between"><span>Orders booked</span><strong>{q.orders}</strong></li>
          <li className="flex justify-between"><span>Cancellation rate</span><strong>{v(q.cancellationRatePct, '%')}</strong></li>
          <li className="flex justify-between text-xs text-ink-soft"><span>declined / cancelled / missed / buyer / unpaid</span><span>{q.cancellationsByCause.seller_declined} / {q.cancellationsByCause.seller_cancelled} / {q.cancellationsByCause.kitchen_missed} / {q.cancellationsByCause.buyer} / {q.cancellationsByCause.buyer_unpaid_or_no_show}</span></li>
          <li className="flex justify-between"><span>Dispute rate</span><strong>{v(q.disputeRatePct, '%')}</strong></li>
          <li className="flex justify-between"><span>Median time to accept</span><strong>{v(q.medianAcceptMinutes, ' min')}</strong></li>
          <li className="flex justify-between"><span>Median at-door → complete</span><strong>{v(q.medianDoorToCompleteMinutes, ' min')}</strong></li>
          <li className="flex justify-between"><span>Average rating</span><strong>{v(q.avgRating)} ({q.ratings})</strong></li>
        </ul>
      </Card>
    </div>
  );
}

export default function Insights() {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<OverviewResult | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    setData(null);
    fetch(`/api/admin/overview?days=${days}`).then((r) => r.json()).then(setData);
  }, [days]);
  const range = `${from ? `from=${from}` : ''}${from && to ? '&' : ''}${to ? `to=${to}` : ''}`;
  // fetch (not a plain link) so the admin re-auth prompt can appear if the 2FA check has gone stale
  async function download(kind: string) {
    const res = await fetch(kind === 'tds' ? '/api/admin/exports/tds' : `/api/admin/exports/${kind}${range ? `?${range}` : ''}`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return toast(d.error || 'Could not export', 'err');
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${BRAND.slug}-${kind}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Downloaded');
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Insights</h1>
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="!w-auto" aria-label="Window" data-testid="window">{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</Select>
      </div>
      {!data ? <Skeleton className="h-64 w-full" /> : (
        <>
          <section><h2 className="mb-2 text-lg font-bold">All societies</h2><Block m={data.global} id="all" /></section>
          {data.bySociety.map((s) => (
            <section key={s.societyId}><h2 className="mb-2 text-lg font-bold">{s.name}</h2><Block m={s.metrics} id={`soc-${s.societyId}`} /></section>
          ))}
        </>
      )}
      <Card className="space-y-3 p-4" data-testid="exports">
        <div className="eyebrow">EXPORTS (CSV, opening one is logged and needs a fresh 2FA code)</div>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-rice-line px-2 py-2" aria-label="From" /></label>
          <label className="text-xs">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-rice-line px-2 py-2" aria-label="To" /></label>
        </div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {EXPORTS.map((e) => (
            <li key={e.kind}><Button variant="ghost" size="sm" onClick={() => download(e.kind)} data-testid={`export-${e.kind}`}>⬇ {e.label}</Button></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
