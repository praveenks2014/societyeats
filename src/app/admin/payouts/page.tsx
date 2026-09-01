'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type PayoutRow = {
  id: number;
  sellerId: number;
  sellerName: string;
  kitchenName: string;
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
  payoutDestinationSnapshot: string | null;
  createdAt: string;
};

type Data = {
  payouts: PayoutRow[];
  summary: { pendingCount: number; pendingPayableInPaise: number };
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

export default function AdminPayouts() {
  const [data, setData] = useState<Data | null>(null);
  const [generating, setGenerating] = useState(false);
  const [utrInputs, setUtrInputs] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/admin/payouts')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }
  useEffect(load, []);

  async function generate() {
    setGenerating(true);
    const res = await fetch('/api/admin/payouts', { method: 'POST' });
    const d = await res.json();
    setGenerating(false);
    if (!res.ok) {
      toast(d.error || 'Could not generate batch', 'err');
      return;
    }
    toast(
      d.payoutsCreated > 0
        ? `Batch generated: ${d.payoutsCreated} seller${d.payoutsCreated === 1 ? '' : 's'}, ${d.ordersSwept} orders 💸`
        : 'Nothing new to pay out yet — orders need 48h to clear first',
    );
    load();
  }

  async function markPaid(id: number) {
    const utrReference = (utrInputs[id] ?? '').trim();
    if (!utrReference) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/payouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utrReference }),
    });
    const d = await res.json();
    setBusyId(null);
    if (!res.ok) {
      toast(d.error || 'Could not mark paid', 'err');
      return;
    }
    toast('Marked paid ✅');
    setUtrInputs((p) => ({ ...p, [id]: '' }));
    load();
  }

  if (!data) return <Skeleton className="h-64 w-full" />;
  const { payouts, summary } = data;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Seller payouts</h1>
          <p className="mt-1 text-sm text-ink-soft">
            GharSe is the merchant of record — payments settle to the platform, and cooks are paid
            out as disclosed suppliers on a manual T+2 cadence (no live bank rails yet).
          </p>
        </div>
        <Button loading={generating} onClick={generate}>
          Generate T+2 batch
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Card className="p-3.5">
          <div className="text-lg font-bold">{summary.pendingCount}</div>
          <div className="text-xs text-ink-faint">Payouts awaiting transfer</div>
        </Card>
        <Card className="border-leaf p-3.5">
          <div className="text-lg font-bold text-leaf">{formatINR(summary.pendingPayableInPaise)}</div>
          <div className="text-xs text-ink-faint">Total payable now</div>
        </Card>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          Orders join a batch once delivered/collected for 48h+ — same-day disputes clear first.
        </p>
        <a
          href="/api/admin/payouts/export"
          className={`shrink-0 rounded-xl border border-leaf px-4 py-2 text-sm font-semibold text-leaf hover:bg-leaf-tint ${
            summary.pendingCount === 0 ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          ⬇ Export CSV
        </a>
      </div>

      {payouts.length === 0 ? (
        <EmptyState
          emoji="💸"
          title="No payouts yet"
          body="Once orders have been delivered/collected for 48 hours, generate the first batch."
        />
      ) : (
        <div className="mt-5 space-y-3">
          {payouts.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    {p.kitchenName} <span className="text-xs font-normal text-ink-faint">#{p.id}</span>
                  </div>
                  <div className="text-xs text-ink-faint">
                    {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)} · {p.orderCount} order
                    {p.orderCount === 1 ? '' : 's'} · {p.payoutDestinationSnapshot ?? 'no VPA/bank on file'}
                  </div>
                </div>
                {p.status === 'paid' ? (
                  <Badge tone="green">Paid · UTR {p.utrReference}</Badge>
                ) : (
                  <Badge tone="amber">Pending transfer</Badge>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <Row k="Gross sales" v={formatINR(p.grossSalesInPaise)} />
                <Row k="Commission" v={`−${formatINR(p.commissionInPaise)}`} />
                <Row k="Gateway fee (est.)" v={`−${formatINR(p.gatewayFeeEstimateInPaise)}`} />
                <Row k="TDS 194-O" v={p.tds194OInPaise > 0 ? `−${formatINR(p.tds194OInPaise)}` : '—'} />
                {p.refundDeductionInPaise > 0 && (
                  <Row k="Refund deduction" v={`−${formatINR(p.refundDeductionInPaise)}`} />
                )}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-dashed border-rice-line pt-2">
                <span className="text-sm font-semibold">Net payable</span>
                <span className="text-base font-bold text-leaf">{formatINR(p.netPayableInPaise)}</span>
              </div>

              {p.status === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <Input
                    placeholder="UTR / transaction reference"
                    value={utrInputs[p.id] ?? ''}
                    onChange={(e) => setUtrInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    loading={busyId === p.id}
                    disabled={!(utrInputs[p.id] ?? '').trim()}
                    onClick={() => markPaid(p.id)}
                  >
                    Mark paid
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink-faint">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}
