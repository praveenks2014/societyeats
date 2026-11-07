'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Select } from '@/components/ui';
import { useToast } from '@/components/providers';
import { launchRazorpay } from '@/components/razorpay';
import { formatINR } from '@/lib/money';

type Plan = { id: number; sellerId: number; name: string; days: string[]; slot: string; active: boolean; skipCutoffHours: number | null; dishes: { id: number; title: string; price: number }[] };
type Day = { id: number; status: string; scheduledFor: string | null };
type Sub = { id: number; planId: number; status: string; weekStart: string; days: Day[] };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }) : '');
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Meal plans for buyers. With `sellerId` it lists that kitchen's plans with a "book a week" flow; "My plans" lists the buyer's booked weeks
 * with skip-a-day, pause and cancel. Renders nothing while the feature is off (the API answers 404).
 */
export function MealPlans({ sellerId }: { sellerId?: number }) {
  const toast = useToast();
  const [data, setData] = useState<{ plans: Plan[]; mine: Sub[]; skipCutoffHours: number } | null>(null);
  const [off, setOff] = useState(false);
  const [start, setStart] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/meal-plans${sellerId ? `?sellerId=${sellerId}` : ''}`);
    if (r.status === 404) return setOff(true);
    if (r.ok) setData(await r.json());
  }, [sellerId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function book(plan: Plan) {
    setBusy(true);
    const r = await fetch(`/api/meal-plans/${plan.id}/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: start[plan.id] || isoDay(2) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setBusy(false);
      return toast(j.error || 'Could not book the week', 'err');
    }
    const anchor = j.orderIds[0] as number;
    const done = async () => {
      setBusy(false);
      toast('Week booked. Pay each day’s food to the kitchen at the door.');
      await load();
    };
    if (j.payment.mode === 'none') return done();
    if (j.payment.mode === 'mock') {
      await fetch('/api/payments/mock-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: anchor, outcome: 'success' }) });
      return done();
    }
    launchRazorpay({
      keyId: j.payment.keyId,
      razorpayOrderId: j.payment.razorpayOrderId,
      amountInPaise: j.payment.amountInPaise,
      description: `${plan.name}: platform fee for the week`,
      onSuccess: async (resp) => {
        const v = await fetch('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: anchor, ...resp }) });
        if (!v.ok) toast('We could not confirm that payment. If money left your account it will be refunded.', 'err');
        await done();
      },
      onDismiss: () => {
        setBusy(false);
        toast('Payment not completed. Your week is held for a short time.', 'err');
      },
      onLoadError: () => {
        setBusy(false);
        toast('Could not open the payment sheet', 'err');
      },
    });
  }

  async function skip(orderId: number) {
    const r = await fetch('/api/meal-plans/skip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) });
    const j = await r.json().catch(() => ({}));
    toast(r.ok ? 'Day skipped' : j.error || 'Could not skip that day', r.ok ? undefined : 'err');
    await load();
  }

  async function end(subId: number, action: 'pause' | 'cancel') {
    const r = await fetch(`/api/meal-plans/subs/${subId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const j = await r.json().catch(() => ({}));
    toast(r.ok ? `${action === 'pause' ? 'Paused' : 'Cancelled'}: ${j.skipped} day(s) skipped${j.kept ? `, ${j.kept} too close to skip` : ''}` : j.error || 'Could not do that', r.ok ? undefined : 'err');
    await load();
  }

  if (off || !data) return null;
  const mine = data.mine.filter((m) => m.status !== 'cancelled');
  if (!sellerId && mine.length === 0) return <p className="text-sm text-ink-soft" data-testid="my-plans-empty">You have no meal plans yet. Open a kitchen to book one.</p>;
  return (
    <section className="mt-8" data-testid="meal-plans">
      {sellerId && data.plans.length > 0 && (
        <>
          <h2 className="text-lg font-bold">Meal plans</h2>
          <p className="text-xs text-ink-faint">Book a week at once. You pay one small platform fee now; each day’s food is paid to the kitchen at your door. You can skip a day up to {data.skipCutoffHours} hours before it.</p>
          <div className="mt-3 space-y-3">
            {data.plans.map((p) => {
              const perDay = p.dishes.length ? Math.round(p.dishes.reduce((a, d) => a + d.price, 0) / p.dishes.length) : 0;
              return (
                <Card key={p.id} className="p-4" data-testid={`plan-${p.id}`}>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-ink-faint">{p.days.join(', ')} · {p.slot} · about {formatINR(perDay)} a day · {p.dishes.map((d) => d.title).join(', ')}</div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="text-xs font-semibold">First day
                      <Select value={start[p.id] ?? isoDay(2)} onChange={(e) => setStart({ ...start, [p.id]: e.target.value })} data-testid={`plan-start-${p.id}`}>
                        {Array.from({ length: 7 }, (_, i) => isoDay(2 + i)).map((d) => <option key={d} value={d}>{d}</option>)}
                      </Select>
                    </label>
                    <Button loading={busy} onClick={() => book(p)} data-testid={`plan-book-${p.id}`}>Book this week</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
      {mine.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-bold" data-testid="my-plans-title">My plans</h2>
          <div className="mt-3 space-y-3" data-testid="my-plans">
            {mine.map((s) => (
              <Card key={s.id} className="p-4" data-testid={`sub-${s.id}`} data-status={s.status}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Week of {s.weekStart}</span>
                  <Badge tone={s.status === 'active' ? 'green' : 'neutral'}>{s.status}</Badge>
                </div>
                <ul className="mt-2 divide-y divide-rice-line text-sm">
                  {s.days.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 py-1.5" data-testid={`sub-day-${d.id}`}>
                      <span>{fmt(d.scheduledFor)} <span className="text-xs text-ink-faint">· {d.status.replace(/_/g, ' ')}</span></span>
                      {s.status === 'active' && !d.status.startsWith('cancelled') && ['booked', 'accepted', 'fee_pending'].includes(d.status) && (
                        <button className="min-h-[44px] px-2 text-xs font-semibold text-chili underline" onClick={() => skip(d.id)} data-testid={`skip-${d.id}`}>Skip this day</button>
                      )}
                    </li>
                  ))}
                </ul>
                {s.status === 'active' && (
                  <div className="mt-2 flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => end(s.id, 'pause')} data-testid={`pause-${s.id}`}>Pause the rest</Button>
                    <Button variant="ghost" size="sm" onClick={() => end(s.id, 'cancel')} data-testid={`cancel-${s.id}`}>Cancel</Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
