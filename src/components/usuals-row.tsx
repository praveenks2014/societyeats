'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { useCart, useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type U = { id: number; title: string; pricePaise: number; isVeg: boolean; photoUrl: string | null; maxQty: number; sellerId: number; kitchen: string; times: number };

/** “Your usuals”: what you order most, one tap to add. Hidden when signed out or when there is no history yet. */
export function UsualsRow() {
  const [rows, setRows] = useState<U[]>([]);
  const { add, replaceWith, vendor } = useCart();
  const toast = useToast();
  useEffect(() => {
    fetch('/api/usuals').then((r) => (r.ok ? r.json() : { usuals: [] })).then((d) => setRows(d.usuals ?? [])).catch(() => {});
  }, []);
  if (!rows.length) return null;
  function addOne(u: U) {
    const v = { kind: 'seller' as const, id: u.sellerId, name: u.kitchen };
    const item = { id: u.id, title: u.title, pricePaise: u.pricePaise, isVeg: u.isVeg, photoUrl: u.photoUrl, maxQty: u.maxQty };
    if (vendor && !(vendor.kind === 'seller' && vendor.id === u.sellerId)) replaceWith(v, item);
    else add(v, item);
    toast(`${u.title} added`);
  }
  return (
    <section className="mt-6" data-testid="usuals">
      <div className="eyebrow">YOUR USUALS</div>
      <div className="no-scrollbar -mx-4 mt-2 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {rows.map((u) => (
          <div key={u.id} className="w-44 shrink-0 rounded-card border border-rice-line bg-white p-3" data-testid="usual-card">
            <div className="truncate text-sm font-semibold">{u.title}</div>
            <div className="truncate text-xs text-ink-faint">{u.kitchen} · ordered {u.times}×</div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm font-bold">{formatINR(u.pricePaise)}</span>
              <Button size="sm" variant="secondary" onClick={() => addOne(u)} data-testid="usual-add">Add</Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
