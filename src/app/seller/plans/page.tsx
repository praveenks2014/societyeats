'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Plan = { id: number; name: string; days: string[]; slot: string; active: boolean; skipCutoffHours: number | null; dishes: { id: number; title: string; price: number }[] };
type Dish = { id: number; title: string; priceInPaise: number; isActive: boolean; moderationStatus: string };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const empty = { id: 0, name: '', days: ['mon', 'tue', 'wed', 'thu', 'fri'], slot: 'lunch', listingIds: [] as number[], skipCutoff: '' };

/** The kitchen's weekly meal plans: create, edit and pause. A plan is a set of days, a meal slot and a dish rotation; each day is priced by its dish. */
export default function SellerPlansPage() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [off, setOff] = useState(false);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/meal-plans?mine=1');
    if (r.status === 404) return setOff(true);
    if (r.ok) setPlans((await r.json()).plans);
    const d = await fetch('/api/seller/listings');
    if (d.ok) setDishes(((await d.json()).listings as Dish[]).filter((x) => x.isActive && x.moderationStatus === 'approved'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    const body = { name: form.name, days: form.days, slot: form.slot, listingIds: form.listingIds, ...(form.id ? { skipCutoffHours: form.skipCutoff === '' ? null : Number(form.skipCutoff) } : {}) };
    const r = await fetch(form.id ? `/api/meal-plans/${form.id}` : '/api/meal-plans', { method: form.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error || 'Could not save the plan', 'err');
    toast('Plan saved');
    setForm(empty);
    await load();
  }
  async function toggle(p: Plan) {
    const r = await fetch(`/api/meal-plans/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !p.active }) });
    if (!r.ok) toast('Could not change the plan', 'err');
    await load();
  }
  const edit = (p: Plan) => setForm({ id: p.id, name: p.name, days: p.days, slot: p.slot, listingIds: p.dishes.map((d) => d.id), skipCutoff: p.skipCutoffHours == null ? '' : String(p.skipCutoffHours) });
  const priceOf = (ids: number[]) => ids.reduce((a, id) => a + (dishes.find((d) => d.id === id)?.priceInPaise ?? 0), 0);

  if (off) return <div className="pt-6"><EmptyState emoji="🗓️" title="Meal plans are not switched on" body="An admin can switch them on in Settings → Feature flags." /></div>;
  return (
    <div className="mx-auto max-w-2xl space-y-4 pt-4" data-testid="seller-plans">
      <h1 className="text-2xl font-bold">Meal plans</h1>
      <p className="text-sm text-ink-soft">Neighbours book a week of lunches or dinners at once. Each day is an ordinary order: the buyer pays the platform fee up front and pays you for the food at the door. The dishes rotate through the days you choose.</p>

      <Card className="space-y-3 p-4" data-testid="plan-form">
        <div className="eyebrow">{form.id ? 'EDIT PLAN' : 'NEW PLAN'}</div>
        <Field label="Plan name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="plan-name" /></Field>
        <div>
          <div className="text-sm font-semibold">Days you cook</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <button key={d} type="button" aria-pressed={form.days.includes(d)} onClick={() => setForm({ ...form, days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] })} className={`min-h-[44px] rounded-pill px-3 text-xs font-semibold ${form.days.includes(d) ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`} data-testid={`plan-day-${d}`}>{d}</button>
            ))}
          </div>
        </div>
        <Field label="Meal"><Select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })} data-testid="plan-slot"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option></Select></Field>
        <div>
          <div className="text-sm font-semibold">Dishes in the rotation (in order)</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {dishes.map((d) => (
              <button key={d.id} type="button" aria-pressed={form.listingIds.includes(d.id)} onClick={() => setForm({ ...form, listingIds: form.listingIds.includes(d.id) ? form.listingIds.filter((x) => x !== d.id) : [...form.listingIds, d.id] })} className={`min-h-[44px] rounded-pill px-3 text-xs font-semibold ${form.listingIds.includes(d.id) ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`} data-testid={`plan-dish-${d.id}`}>{d.title} · {formatINR(d.priceInPaise)}</button>
            ))}
          </div>
          {form.listingIds.length > 0 && <p className="mt-1 text-xs text-ink-faint">Rotation: {formatINR(priceOf(form.listingIds))} across {form.listingIds.length} dish(es), about {formatINR(Math.round(priceOf(form.listingIds) / form.listingIds.length))} a day (each dish at its listed price).</p>}
        </div>
        {form.id > 0 && <Field label="Buyers can skip a day up to this many hours before it" hint="Leave empty for the platform default."><Input type="number" min={1} max={72} value={form.skipCutoff} onChange={(e) => setForm({ ...form, skipCutoff: e.target.value })} data-testid="plan-cutoff" /></Field>}
        <div className="flex gap-2">
          <Button loading={busy} onClick={save} disabled={form.name.trim().length < 3 || !form.days.length || !form.listingIds.length} data-testid="plan-save">{form.id ? 'Save changes' : 'Create plan'}</Button>
          {form.id > 0 && <Button variant="ghost" onClick={() => setForm(empty)}>Cancel edit</Button>}
        </div>
      </Card>

      <div className="space-y-3" data-testid="plan-list">
        {plans?.length === 0 && <EmptyState emoji="🗓️" title="No plans yet" body="Create your first weekly plan above." />}
        {plans?.map((p) => (
          <Card key={p.id} className="p-4" data-testid={`seller-plan-${p.id}`} data-active={p.active}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{p.name}</span>
              <Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'Live' : 'Paused'}</Badge>
            </div>
            <div className="text-xs text-ink-faint">{p.days.join(', ')} · {p.slot} · {p.dishes.map((d) => d.title).join(', ')}{p.skipCutoffHours ? ` · skip up to ${p.skipCutoffHours}h before` : ''}</div>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => edit(p)} data-testid={`plan-edit-${p.id}`}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => toggle(p)} data-testid={`plan-toggle-${p.id}`}>{p.active ? 'Pause' : 'Resume'}</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
