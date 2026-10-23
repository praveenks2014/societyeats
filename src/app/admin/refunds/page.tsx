'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Due = { id: number; orderId: number; sellerId: number; kitchenName: string; amountInPaise: number; reason: string; status: string; refundUtr: string | null; createdAt: string; lastChasedAt: string | null };
type Ref = { id: number; kind: string; orderId: number | null; subscriptionId: number | null; amountInPaise: number; status: string; reason: string | null; initiatedBy: string; createdAt: string; error: string | null };

export default function AdminRefunds() {
  const [data, setData] = useState<{ kitchenRefundsDue: Due[]; platformRefunds: Ref[] } | null>(null);
  const toast = useToast();
  const load = useCallback(() => {
    fetch('/api/admin/refunds').then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);
  async function chase(id: number) {
    const res = await fetch('/api/admin/refunds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'chase' }) });
    if (res.ok) toast('Kitchen reminded'); else toast('Failed', 'err');
    load();
  }
  if (!data) return <Skeleton className="h-48 w-full" />;
  const due = data.kitchenRefundsDue.filter((d) => d.status === 'due');
  const done = data.kitchenRefundsDue.filter((d) => d.status !== 'due');
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section>
        <h1 className="text-2xl font-bold">Refunds</h1>
        <h2 className="mt-4 text-lg font-bold">Kitchen refunds due ({due.length})</h2>
        <p className="text-sm text-ink-soft">Food money the kitchen owes buyers. PadosiPlate never held it — chase the kitchen until they record a UPI reference.</p>
        {due.length === 0 ? <div className="mt-3"><EmptyState emoji="✅" title="Nothing outstanding" /></div> : (
          <div className="mt-3 space-y-2">
            {due.map((d) => (
              <Card key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div><div className="font-semibold">{d.kitchenName} · order #{d.orderId}</div><div className="text-xs text-ink-faint">{d.reason.replace('_', ' ')} · since {new Date(d.createdAt).toLocaleDateString('en-IN')}{d.lastChasedAt ? ` · chased ${new Date(d.lastChasedAt).toLocaleDateString('en-IN')}` : ''}</div></div>
                <div className="flex items-center gap-2"><strong>{formatINR(d.amountInPaise)}</strong><Button size="sm" variant="secondary" onClick={() => chase(d.id)}>Chase</Button></div>
              </Card>
            ))}
          </div>
        )}
        {done.length > 0 && <p className="mt-2 text-xs text-ink-faint">{done.length} already returned by kitchens.</p>}
      </section>
      <section>
        <h2 className="text-lg font-bold">Platform refunds (Razorpay)</h2>
        <div className="mt-3 space-y-2">
          {data.platformRefunds.length === 0 && <p className="text-sm text-ink-faint">None yet.</p>}
          {data.platformRefunds.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div><div className="font-semibold">{r.kind.replace('_', ' ')} · {r.orderId ? `order #${r.orderId}` : `subscription #${r.subscriptionId}`}</div><div className="text-xs text-ink-faint">{r.reason} · {r.initiatedBy} · {new Date(r.createdAt).toLocaleString('en-IN')}{r.error ? ` · ${r.error}` : ''}</div></div>
              <div className="flex items-center gap-2"><strong>{formatINR(r.amountInPaise)}</strong><Badge tone={r.status === 'processed' ? 'green' : r.status === 'failed' ? 'red' : 'amber'}>{r.status}</Badge></div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
