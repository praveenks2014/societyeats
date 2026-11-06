'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Plan = { id: number; name: string; durationMonths: number; pricePaise: number; active: boolean; sort: number };

export default function AdminPlans() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [draft, setDraft] = useState({ name: '', durationMonths: '1', priceRupees: '' });
  const load = useCallback(() => {
    fetch('/api/admin/subscriptions').then((r) => r.json()).then((d) => setPlans(d.plans));
  }, []);
  useEffect(load, [load]);

  async function save(p: { id?: number; name: string; durationMonths: number; pricePaise: number; active: boolean; sort?: number }) {
    const res = await fetch('/api/admin/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'plan_save', ...p }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not save', 'err');
    toast('Saved');
    setDraft({ name: '', durationMonths: '1', priceRupees: '' });
    load();
  }
  if (!plans) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Subscription plans</h1>
        <p className="mt-1 text-sm text-ink-soft">Archive a plan to stop selling it; existing subscriptions keep running. The Founding plan is granted on approval and is never sold. To waive or extend one kitchen, open it under Kitchens.</p>
      </div>
      {plans.map((p) => (
        <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`plan-row-${p.id}`}>
          <div>
            <div className="font-semibold">{p.name}</div>
            <div className="text-xs text-ink-faint">{p.durationMonths} month(s) · {p.pricePaise === 0 ? 'free (granted)' : formatINR(p.pricePaise)}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'On sale' : 'Archived'}</Badge>
            {p.pricePaise > 0 && (
              <Button size="sm" variant="secondary" onClick={() => save({ id: p.id, name: p.name, durationMonths: p.durationMonths, pricePaise: p.pricePaise, active: !p.active, sort: p.sort })} data-testid={`plan-toggle-${p.id}`}>{p.active ? 'Archive' : 'Restore'}</Button>
            )}
          </div>
        </Card>
      ))}
      <Card className="space-y-3 p-4">
        <div className="eyebrow">NEW PLAN</div>
        <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="plan-name" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Months"><Input inputMode="numeric" value={draft.durationMonths} onChange={(e) => setDraft({ ...draft, durationMonths: e.target.value })} /></Field>
          <Field label="Price (₹, before GST)"><Input inputMode="numeric" value={draft.priceRupees} onChange={(e) => setDraft({ ...draft, priceRupees: e.target.value })} data-testid="plan-price" /></Field>
        </div>
        <Button disabled={!draft.name.trim() || !Number(draft.priceRupees)} onClick={() => save({ name: draft.name, durationMonths: Number(draft.durationMonths), pricePaise: Math.round(Number(draft.priceRupees) * 100), active: true, sort: plans.length + 1 })} data-testid="plan-create">Create plan</Button>
      </Card>
    </div>
  );
}
