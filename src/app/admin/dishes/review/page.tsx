'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, VegDot } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Dish = { id: number; sellerId: number; kitchenName: string; title: string; description: string | null; priceInPaise: number; isVeg: boolean; photoUrl: string | null; moderationStatus: string; moderationNote: string | null; approvedSnapshotJson: { title: string; photoUrl: string | null; priceInPaise: number } | null };

export default function DishReview() {
  const [status, setStatus] = useState('pending');
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const toast = useToast();
  const load = useCallback(() => {
    setDishes(null);
    fetch(`/api/admin/dishes?status=${status}`).then((r) => r.json()).then((d) => setDishes(d.dishes)).catch(() => {});
  }, [status]);
  useEffect(load, [load]);

  async function act(id: number, body: Record<string, unknown>, msg: string) {
    const res = await fetch(`/api/admin/dishes/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Failed', 'err');
    toast(msg);
    load();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dish review</h1>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto" aria-label="Status filter">
          {['pending', 'rejected', 'hidden', 'approved', 'all'].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      <p className="mt-1 text-sm text-ink-soft">New dishes — and dishes whose name or photo changes or whose price moves by more than 30% — wait here before buyers can see them.</p>
      {!dishes ? <Skeleton className="mt-5 h-40 w-full" /> : dishes.length === 0 ? (
        <div className="mt-6"><EmptyState emoji="✅" title="Queue is empty" /></div>
      ) : (
        <div className="mt-5 space-y-3">
          {dishes.map((d) => {
            const prev = d.approvedSnapshotJson;
            return (
              <Card key={d.id} className="p-4" data-testid={`dish-${d.id}`}>
                <div className="flex gap-3">
                  <FoodImage src={d.photoUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><VegDot isVeg={d.isVeg} /><span className="font-semibold">{d.title}</span><Badge tone={d.moderationStatus === 'pending' ? 'amber' : d.moderationStatus === 'approved' ? 'green' : 'red'}>{d.moderationStatus}</Badge></div>
                    <div className="text-sm text-ink-soft">{formatINR(d.priceInPaise)} · <Link href={`/admin/kitchens/${d.sellerId}`} className="underline">{d.kitchenName}</Link></div>
                    {d.description && <p className="mt-1 text-xs text-ink-faint">{d.description}</p>}
                    {prev && (prev.title !== d.title || prev.priceInPaise !== d.priceInPaise || prev.photoUrl !== d.photoUrl) && (
                      <p className="mt-1 text-xs text-turmeric-deep">Changed from: “{prev.title}” · {formatINR(prev.priceInPaise)}{prev.photoUrl !== d.photoUrl ? ' · new photo' : ''}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {d.moderationStatus === 'hidden' ? (
                    <Button size="sm" onClick={() => act(d.id, { action: 'unhide' }, 'Visible again')}>Unhide</Button>
                  ) : (
                    <>
                      {['pending', 'rejected'].includes(d.moderationStatus) && <Button size="sm" onClick={() => act(d.id, { action: 'approve' }, 'Approved ✅')} data-testid="approve-dish">Approve</Button>}
                      <Input className="min-w-[160px] flex-1" placeholder="Reason (required to reject / hide)" value={reasons[d.id] ?? ''} onChange={(e) => setReasons((r) => ({ ...r, [d.id]: e.target.value }))} aria-label="Reason" />
                      {d.moderationStatus === 'pending' && <Button size="sm" variant="danger" disabled={!reasons[d.id]?.trim()} onClick={() => act(d.id, { action: 'reject', reason: reasons[d.id] }, 'Rejected')}>Reject</Button>}
                      <Button size="sm" variant="ghost" disabled={!reasons[d.id]?.trim()} onClick={() => act(d.id, { action: 'hide', category: 'other', reason: reasons[d.id] }, 'Hidden')}>Hide</Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
