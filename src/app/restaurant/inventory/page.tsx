'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, Skeleton, VegDot } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Item = {
  id: number;
  title: string;
  priceInPaise: number;
  isVeg: boolean;
  photoUrl: string | null;
  stockQty: number;
  isActive: boolean;
};

export default function RestaurantInventory() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [restName, setRestName] = useState('');
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  function load() {
    fetch('/api/restaurant/items')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        setItems(d.items);
        setRestName(d.restaurant.name);
      })
      .catch(() => {});
  }
  useEffect(load, []);

  async function patch(id: number, body: Record<string, unknown>) {
    const res = await fetch(`/api/restaurant/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast('Could not update', 'err');
      return;
    }
    load();
  }

  if (!items) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Live inventory</h1>
        <Button onClick={() => setAdding(true)}>+ Add item</Button>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {restName} — stock counts update live for buyers on the mall page.
      </p>

      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <Card key={item.id} className={`flex items-center gap-3 p-3 ${item.isActive ? '' : 'opacity-60'}`}>
            <FoodImage src={item.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <VegDot isVeg={item.isVeg} />
                <span className="truncate font-semibold">{item.title}</span>
              </div>
              <div className="text-sm text-ink-soft">{formatINR(item.priceInPaise)}</div>
              {item.stockQty === 0 && <Badge tone="red" className="mt-1">Out of stock</Badge>}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => patch(item.id, { stockQty: item.stockQty - 1 })}
                disabled={item.stockQty <= 0}
                className="h-9 w-9 rounded-xl border border-rice-line text-lg font-bold text-ink-soft disabled:opacity-30"
                aria-label="Decrease stock"
              >
                −
              </button>
              <span className="min-w-8 text-center font-bold">{item.stockQty}</span>
              <button
                onClick={() => patch(item.id, { stockQty: item.stockQty + 1 })}
                className="h-9 w-9 rounded-xl border border-rice-line text-lg font-bold text-ink-soft"
                aria-label="Increase stock"
              >
                +
              </button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => patch(item.id, { isActive: !item.isActive })}>
              {item.isActive ? 'Hide' : 'Show'}
            </Button>
          </Card>
        ))}
      </div>

      <AddItemModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          load();
        }}
      />
    </div>
  );
}

function AddItemModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: '', priceRupees: '', isVeg: true, stockQty: '10' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    setBusy(true);
    const res = await fetch('/api/restaurant/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        priceRupees: Number(form.priceRupees),
        isVeg: form.isVeg,
        stockQty: Number(form.stockQty),
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not add', 'err');
      return;
    }
    setForm({ title: '', priceRupees: '', isVeg: true, stockQty: '10' });
    toast('Item added');
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add menu item" sheet>
      <div className="space-y-4">
        <Field label="Item name">
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)">
            <Input inputMode="numeric" value={form.priceRupees} onChange={(e) => setForm((f) => ({ ...f, priceRupees: e.target.value }))} />
          </Field>
          <Field label="Stock">
            <Input inputMode="numeric" value={form.stockQty} onChange={(e) => setForm((f) => ({ ...f, stockQty: e.target.value }))} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isVeg} onChange={(e) => setForm((f) => ({ ...f, isVeg: e.target.checked }))} className="h-4 w-4 accent-leaf" />
          Vegetarian
        </label>
        <Button size="lg" className="w-full" loading={busy} onClick={save}>
          Add item
        </Button>
      </div>
    </Modal>
  );
}
