'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Item = { id: number; orderId: number; amountInPaise: number; reason: string; status: string; refundUtr: string | null };

export default function RefundsDue() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [utr, setUtr] = useState<Record<number, string>>({});
  const toast = useToast();
  const load = useCallback(() => {
    fetch('/api/seller/refunds-due').then((r) => r.json()).then((d) => setItems(d.items)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function mark(id: number) {
    const res = await fetch('/api/seller/refunds-due', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, utr: utr[id] ?? '' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not save', 'err');
    toast('Marked as refunded ✅');
    load();
  }

  if (!items) return <Skeleton className="mx-auto h-40 w-full max-w-2xl" />;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Food refunds you owe</h1>
      <p className="mt-1 text-sm text-ink-soft">When an order is cancelled after a buyer paid you, or a complaint is upheld, the food amount goes back from <strong>you</strong> (PadosiPlate never held it). Return it by UPI and record the reference.</p>
      {items.length === 0 ? (
        <div className="mt-6"><EmptyState emoji="✅" title="Nothing owed" /></div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((i) => (
            <Card key={i.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Order #{i.orderId} · {formatINR(i.amountInPaise)}</div>
                <Badge tone={i.status === 'due' ? 'red' : 'green'}>{i.status === 'due' ? 'Due' : 'Refunded'}</Badge>
              </div>
              <div className="text-xs capitalize text-ink-faint">{i.reason.replace('_', ' ')}</div>
              {i.status === 'due' ? (
                <div className="mt-3 flex gap-2">
                  <Input placeholder="UPI reference (UTR)" value={utr[i.id] ?? ''} onChange={(e) => setUtr((u) => ({ ...u, [i.id]: e.target.value }))} aria-label="UPI reference" />
                  <Button onClick={() => mark(i.id)}>Mark refunded</Button>
                </div>
              ) : (
                <div className="mt-1 text-xs text-ink-soft">UTR {i.refundUtr}</div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
