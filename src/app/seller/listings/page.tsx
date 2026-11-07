'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, VegDot } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useToast } from '@/components/providers';
import { MenuPublisher } from '@/components/menu-publisher';
import { formatINR } from '@/lib/money';

type Listing = {
  id: number;
  title: string;
  description: string | null;
  priceInPaise: number;
  isVeg: boolean;
  foodMark?: 'veg' | 'egg' | 'non_veg';
  ingredients?: string | null;
  allergensJson?: string[] | null;
  allergensDeclared?: boolean;
  spiceLevel?: string | null;
  portionSize?: string | null;
  bestWithinHours?: number | null;
  storageAdvice?: string | null;
  leadTimeDays?: number;
  maxPortionsPerSlot?: number | null;
  cuisine: string;
  photoUrl: string | null;
  prepTimeMins: number;
  availableQty: number;
  slotsJson: { days: string[]; slots: string[] } | null;
  isActive: boolean;
  moderationStatus: 'pending' | 'approved' | 'rejected' | 'hidden';
  moderationNote: string | null;
};

const CUISINES = ['Biryani', 'Tiffins', 'North Indian', 'Jain Thali', 'Bengali Sweets', 'Keto Bowls', 'Desserts', 'Snacks', 'Other'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SLOTS = ['breakfast', 'lunch', 'dinner'];
const ALLERGENS = ['gluten', 'milk', 'nuts', 'peanuts', 'soy', 'egg', 'fish', 'shellfish', 'sesame', 'mustard'];

export default function SellerListings() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [editing, setEditing] = useState<Listing | 'new' | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/seller/listings')
      .then((r) => r.json())
      .then((d) => setRows(d.listings))
      .catch(() => {});
  }
  useEffect(load, []);

  async function toggle(row: Listing) {
    const res = await fetch(`/api/seller/listings/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    const d = await res.json();
    if (!res.ok) {
      toast(d.error || 'Could not update', 'err');
      return;
    }
    load();
  }

  if (!rows) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My dishes</h1>
        <Button onClick={() => setEditing('new')}>+ New dish</Button>
      </div>

      <MenuPublisher dishes={rows} />

      {rows.length === 0 ? (
        <EmptyState
          emoji="🍲"
          title="No dishes yet"
          body="Add your first dish — set the portions you can cook and when."
          action={<Button onClick={() => setEditing('new')}>Add a dish</Button>}
        />
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className={`flex items-center gap-3 p-3 ${row.isActive ? '' : 'opacity-60'}`}>
              <FoodImage src={row.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <VegDot isVeg={row.isVeg} />
                  <span className="truncate font-semibold">{row.title}</span>
                </div>
                <div className="mt-0.5 text-sm text-ink-soft">
                  {formatINR(row.priceInPaise)} · {row.availableQty} portions · {row.cuisine}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {!row.isActive && <Badge tone="neutral">Paused</Badge>}
                  {row.moderationStatus === 'pending' && <Badge tone="amber">In review</Badge>}
                  {row.moderationStatus === 'rejected' && <Badge tone="red">Needs changes</Badge>}
                  {row.moderationStatus === 'hidden' && <Badge tone="red">Hidden by PadosiPlate</Badge>}
                </div>
                {row.moderationNote && ['rejected', 'hidden'].includes(row.moderationStatus) && (
                  <p className="mt-1 text-xs text-chili-dark">{row.moderationNote}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(row)}>
                  {row.isActive ? 'Pause' : 'Go live'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ListingForm
        key={editing === 'new' ? 'new' : editing?.id ?? 'closed'}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </div>
  );
}

function ListingForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Listing | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = editing === 'new';
  const row = isNew || !editing ? null : editing;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: row?.title ?? '',
    description: row?.description ?? '',
    priceRupees: row ? String(row.priceInPaise / 100) : '',
    foodMark: row?.foodMark ?? (row?.isVeg === false ? 'non_veg' : 'veg'),
    ingredients: row?.ingredients ?? '',
    allergens: row ? (row.allergensDeclared ? (row.allergensJson?.length ? row.allergensJson : ['none']) : []) : ([] as string[]),
    spiceLevel: row?.spiceLevel ?? '',
    portionSize: row?.portionSize ?? '',
    bestWithinHours: row?.bestWithinHours ? String(row.bestWithinHours) : '',
    storageAdvice: row?.storageAdvice ?? '',
    leadTimeDays: String(row?.leadTimeDays ?? 0),
    maxPortionsPerSlot: row?.maxPortionsPerSlot ? String(row.maxPortionsPerSlot) : '',
    cuisine: row?.cuisine ?? 'Tiffins',
    photoUrl: row?.photoUrl ?? '',
    prepTimeMins: String(row?.prepTimeMins ?? 30),
    availableQty: String(row?.availableQty ?? 10),
    days: row?.slotsJson?.days ?? [...DAYS],
    slots: row?.slotsJson?.slots ?? ['lunch', 'dinner'],
  });
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', 'dish');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json();
    setUploading(false);
    if (!res.ok) {
      toast(d.error || 'Upload failed', 'err');
      return;
    }
    set('photoUrl', d.url);
  }

  async function save() {
    setBusy(true);
    const payload = {
      title: form.title,
      description: form.description,
      priceRupees: Number(form.priceRupees),
      foodMark: form.foodMark,
      ingredients: form.ingredients,
      allergens: form.allergens,
      spiceLevel: form.spiceLevel || null,
      portionSize: form.portionSize || null,
      bestWithinHours: form.bestWithinHours ? Number(form.bestWithinHours) : null,
      storageAdvice: form.storageAdvice || null,
      leadTimeDays: Number(form.leadTimeDays) || 0,
      maxPortionsPerSlot: form.maxPortionsPerSlot ? Number(form.maxPortionsPerSlot) : null,
      cuisine: form.cuisine,
      photoUrl: form.photoUrl,
      prepTimeMins: Number(form.prepTimeMins),
      availableQty: Number(form.availableQty),
      days: form.days,
      slots: form.slots,
    };
    const res = await fetch(isNew ? '/api/seller/listings' : `/api/seller/listings/${row!.id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not save', 'err');
      return;
    }
    toast(isNew ? 'Dish added 🍲' : 'Dish updated');
    onSaved();
  }

  return (
    <Modal open={editing !== null} onClose={onClose} title={isNew ? 'New dish' : 'Edit dish'} sheet>
      <div className="space-y-4">
        <Field label="Dish name">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Hyderabadi Chicken Dum Biryani" />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)">
            <Input inputMode="numeric" value={form.priceRupees} onChange={(e) => set('priceRupees', e.target.value)} />
          </Field>
          <Field label="Cuisine">
            <Select value={form.cuisine} onChange={(e) => set('cuisine', e.target.value)}>
              {CUISINES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Prep time (mins)">
            <Input inputMode="numeric" value={form.prepTimeMins} onChange={(e) => set('prepTimeMins', e.target.value)} />
          </Field>
          <Field label="Portions today">
            <Input inputMode="numeric" value={form.availableQty} onChange={(e) => set('availableQty', e.target.value)} />
          </Field>
        </div>

        <Field label="Food mark" hint="Declared by you; shown to buyers as the green / brown mark.">
          <Select value={form.foodMark} onChange={(e) => set('foodMark', e.target.value)} data-testid="food-mark">
            <option value="veg">🟢 Vegetarian</option>
            <option value="egg">🟡 Contains egg</option>
            <option value="non_veg">🔴 Non-vegetarian</option>
          </Select>
        </Field>
        <Field label="Ingredients">
          <Textarea rows={2} value={form.ingredients} onChange={(e) => set('ingredients', e.target.value)} placeholder="Basmati rice, chicken, curd, onion, spices, ghee" data-testid="ingredients" />
        </Field>
        <Field label="Allergens" hint="Tick every allergen this dish contains, or “none of these”.">
          <div className="flex flex-wrap gap-1.5">
            {[...ALLERGENS, 'none'].map((a) => {
              const on = form.allergens.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  data-testid={`allergen-${a}`}
                  aria-pressed={on}
                  onClick={() => set('allergens', a === 'none' ? (on ? [] : ['none']) : on ? form.allergens.filter((x) => x !== a) : [...form.allergens.filter((x) => x !== 'none'), a])}
                  className={`min-h-[36px] rounded-pill px-3 py-1 text-xs font-semibold capitalize ${on ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`}
                >
                  {a === 'none' ? 'None of these' : a}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Spice level">
            <Select value={form.spiceLevel} onChange={(e) => set('spiceLevel', e.target.value)}>
              <option value="">Not stated</option>
              <option value="mild">Mild</option>
              <option value="medium">Medium</option>
              <option value="hot">Hot</option>
            </Select>
          </Field>
          <Field label="Portion">
            <Input value={form.portionSize} onChange={(e) => set('portionSize', e.target.value)} placeholder="e.g. 350 g, 2 pieces" />
          </Field>
          <Field label="Best within (hours)">
            <Input inputMode="numeric" value={form.bestWithinHours} onChange={(e) => set('bestWithinHours', e.target.value)} />
          </Field>
          <Field label="Pre-order lead (days)">
            <Input inputMode="numeric" value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} />
          </Field>
          <Field label="Max portions per slot">
            <Input inputMode="numeric" value={form.maxPortionsPerSlot} onChange={(e) => set('maxPortionsPerSlot', e.target.value)} />
          </Field>
        </div>
        <Field label="Storage advice">
          <Input value={form.storageAdvice} onChange={(e) => set('storageAdvice', e.target.value)} placeholder="Refrigerate; reheat before eating" />
        </Field>

        <Field label="Photo">
          <div className="flex items-center gap-3">
            {form.photoUrl && <FoodImage src={form.photoUrl} alt="" className="h-14 w-14 rounded-xl" />}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
              {form.photoUrl ? 'Change photo' : 'Upload photo'}
            </Button>
          </div>
        </Field>

        <Field label="Days available">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button
                key={d}
                onClick={() => set('days', form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d])}
                className={`rounded-pill px-3 py-1 text-xs font-semibold capitalize ${
                  form.days.includes(d) ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Meal slots">
          <div className="flex flex-wrap gap-1.5">
            {SLOTS.map((s) => (
              <button
                key={s}
                onClick={() => set('slots', form.slots.includes(s) ? form.slots.filter((x) => x !== s) : [...form.slots, s])}
                className={`rounded-pill px-3 py-1 text-xs font-semibold capitalize ${
                  form.slots.includes(s) ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>

        <Button size="lg" className="w-full" loading={busy} onClick={save}>
          {isNew ? 'Add dish' : 'Save changes'}
        </Button>
      </div>
    </Modal>
  );
}
