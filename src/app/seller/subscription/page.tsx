'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import { useToast } from '@/components/providers';
import { launchRazorpay } from '@/components/razorpay';
import { formatINR } from '@/lib/money';

type Plan = { id: number; name: string; durationMonths: number; pricePaise: number; charge: { basePaise: number; gstPaise: number; totalPaise: number } };
type Sub = {
  id: number;
  planNameSnapshot: string | null;
  durationMonthsSnapshot: number;
  status: string;
  effectiveStatus: string;
  startsAt: string | null;
  endsAt: string | null;
  totalPaise: number;
  paidAt: string | null;
  hasInvoice: boolean;
  notes: string | null;
};
type Data = { status: string; daysLeft: number | null; graceDays: number; plans: Plan[]; gstApplies: boolean; history: Sub[] };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = { active: 'green', waived: 'green', grace: 'amber', expired: 'red', pending_payment: 'neutral', cancelled: 'neutral' };

export default function SubscriptionPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [mock, setMock] = useState<{ subscriptionId: number; amount: number } | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    fetch('/api/seller/subscription').then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function pay(plan: Plan) {
    setBusy(plan.id);
    const res = await fetch('/api/seller/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: plan.id }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(null);
      return toast(d.error || 'Could not start payment', 'err');
    }
    const c = d.checkout;
    if (c.mode === 'mock') {
      setMock({ subscriptionId: c.subscriptionId, amount: c.amountInPaise });
      return;
    }
    launchRazorpay({
      keyId: c.keyId,
      razorpayOrderId: c.razorpayOrderId,
      amountInPaise: c.amountInPaise,
      description: `${plan.name} · kitchen subscription`,
      onSuccess: async (r) => {
        const v = await fetch('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscriptionId: c.subscriptionId, ...r }) });
        setBusy(null);
        if (v.ok) {
          toast('Subscription active ✅');
          load();
        } else toast('Payment verification failed — contact support', 'err');
      },
      onDismiss: () => setBusy(null),
      onLoadError: () => {
        setBusy(null);
        toast('Could not load the payment gateway', 'err');
      },
    });
  }

  async function onMock(outcome: 'success' | 'failure') {
    if (!mock) return;
    const res = await fetch('/api/payments/mock-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscriptionId: mock.subscriptionId, outcome }) });
    setMock(null);
    setBusy(null);
    if (outcome === 'success' && res.ok) {
      toast('Subscription active ✅');
      load();
    } else toast('Payment failed (simulated) — you can try again', 'err');
  }

  if (!data) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  const renewing = ['active', 'waived', 'grace'].includes(data.status);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Subscription</h1>
        <p className="mt-1 text-sm text-ink-soft">
          A subscription keeps your kitchen listed to neighbours. Buyers pay <strong>you</strong> directly for food — PadosiPlate never takes a cut of it.
        </p>
      </div>

      <Card className="p-4" data-testid="sub-status">
        <div className="eyebrow">CURRENT STATUS</div>
        <div className="mt-1 flex items-center gap-2">
          <Badge tone={TONE[data.status] ?? 'neutral'}>{data.status === 'none' ? 'No plan' : data.status === 'waived' ? 'complimentary' : data.status}</Badge>
          {data.daysLeft != null && data.status !== 'expired' && <span className="text-sm text-ink-soft">{data.daysLeft} day(s) left</span>}
        </div>
        {data.status === 'grace' && <p className="mt-2 text-sm text-turmeric-deep">Grace period: your dishes are still visible for {data.graceDays} days after expiry. Renew to avoid being hidden.</p>}
        {data.status === 'expired' && <p className="mt-2 text-sm text-chili-dark">Your dishes are hidden from buyers. Renewing restores them straight away.</p>}
        {renewing && <p className="mt-2 text-xs text-ink-faint">Renewing early stacks: the new period starts when the current one ends.</p>}
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-bold">{renewing ? 'Renew' : 'Choose a plan'}</h2>
        {data.plans.length === 0 ? (
          <EmptyState emoji="🧾" title="No plans available yet" body="PadosiPlate will publish plans shortly." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.plans.map((p) => (
              <Card key={p.id} className="p-4" data-testid={`plan-${p.id}`}>
                <div className="font-display text-lg font-bold">{p.name}</div>
                <div className="text-xs text-ink-faint">{p.durationMonths} month{p.durationMonths === 1 ? '' : 's'} · one-time payment</div>
                <div className="mt-2 text-2xl font-bold">{formatINR(p.charge.totalPaise)}</div>
                {data.gstApplies && <div className="text-xs text-ink-faint">{formatINR(p.charge.basePaise)} + {formatINR(p.charge.gstPaise)} GST</div>}
                <Button className="mt-3 w-full" size="lg" loading={busy === p.id} onClick={() => pay(p)} data-testid={`pay-plan-${p.id}`}>
                  {renewing ? 'Renew' : 'Pay & subscribe'} {formatINR(p.charge.totalPaise)}
                </Button>
              </Card>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-ink-faint">Subscriptions are non-refundable except at PadosiPlate’s discretion (see kitchen terms).</p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">History &amp; invoices</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-ink-faint">No payments yet.</p>
        ) : (
          <div className="space-y-2">
            {data.history.map((h) => (
              <Card key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <div className="font-semibold">{h.planNameSnapshot ?? 'Subscription'}</div>
                  <div className="text-xs text-ink-faint">{fmt(h.startsAt)} → {fmt(h.endsAt)}{h.notes ? ` · ${h.notes}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={TONE[h.effectiveStatus] ?? 'neutral'}>{h.effectiveStatus === 'waived' ? 'complimentary' : h.effectiveStatus.replace('_', ' ')}</Badge>
                  {h.totalPaise > 0 && <span className="font-semibold">{formatINR(h.totalPaise)}</span>}
                  {h.hasInvoice && (
                    <a className="min-h-[44px] content-center px-1 font-semibold text-leaf underline" href={`/api/seller/subscription/${h.id}/invoice`} target="_blank" rel="noreferrer">
                      Invoice
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <MockCheckoutSheet open={!!mock} orderId={mock?.subscriptionId ?? null} amountInPaise={mock?.amount ?? 0} onResult={onMock} onClose={() => { setMock(null); setBusy(null); }} />
    </div>
  );
}
