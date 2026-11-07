'use client';

import { useState } from 'react';
import { Badge, Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Strike = { id: number; kind: string; reason: string | null; createdAt: string; liftedAt: string | null };
type Override = { maxOrdersPerDay?: number; maxFoodValuePerDayPaise?: number; maxFoodValueTotalPaise?: number; expiresAt?: string } | null;

/** Provisional-cap override, strikes and un-pausing for one kitchen. Each action needs a reason, a fresh 2FA check, and is audit-logged. */
export function KitchenControls({ sellerId, strikes, capOverride, pausedReason, onDone }: { sellerId: number; strikes: Strike[]; capOverride: Override; pausedReason: string | null; onDone: () => void }) {
  const toast = useToast();
  const [orders, setOrders] = useState('');
  const [perDay, setPerDay] = useState('');
  const [total, setTotal] = useState('');
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/kitchens/${sellerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not do that', 'err');
    toast(okMsg);
    setReason('');
    onDone();
  }
  const active = strikes.filter((s) => !s.liftedAt);
  return (
    <Card className="space-y-4 p-4" data-testid="kitchen-controls">
      <div className="eyebrow">LIMITS, STRIKES AND PAUSE</div>
      {pausedReason && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-chili-tint px-3 py-2 text-sm text-chili-dark">
          <span>Paused: {pausedReason}</span>
          <Button size="sm" variant="secondary" disabled={reason.trim().length < 3} onClick={() => post({ action: 'unpause', reason }, 'Kitchen unpaused')} data-testid="unpause">Unpause</Button>
        </div>
      )}
      <Field label="Reason for any change below (logged)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="controls-reason" />
      </Field>

      <div>
        <div className="text-sm font-semibold">Provisional limit override {capOverride ? <Badge tone="amber">active</Badge> : null}</div>
        {capOverride && <p className="text-xs text-ink-faint">{capOverride.maxOrdersPerDay != null ? `${capOverride.maxOrdersPerDay} orders/day · ` : ''}{capOverride.maxFoodValuePerDayPaise != null ? `${formatINR(capOverride.maxFoodValuePerDayPaise)}/day · ` : ''}{capOverride.maxFoodValueTotalPaise != null ? `${formatINR(capOverride.maxFoodValueTotalPaise)} total · ` : ''}until {capOverride.expiresAt?.slice(0, 10)}</p>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Orders/day"><Input inputMode="numeric" value={orders} onChange={(e) => setOrders(e.target.value)} data-testid="cap-orders" /></Field>
          <Field label="₹ per day"><Input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} data-testid="cap-day" /></Field>
          <Field label="₹ in total"><Input inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="cap-total" /></Field>
          <Field label="For (days)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" loading={busy} disabled={reason.trim().length < 3 || (!orders && !perDay && !total)} onClick={() => post({ action: 'set_caps', ...(orders ? { maxOrdersPerDay: Number(orders) } : {}), ...(perDay ? { maxFoodValuePerDayPaise: Math.round(Number(perDay) * 100) } : {}), ...(total ? { maxFoodValueTotalPaise: Math.round(Number(total) * 100) } : {}), days: Number(days) || 30, reason }, 'Override saved')} data-testid="cap-save">Save override</Button>
          {capOverride && <Button size="sm" variant="secondary" disabled={reason.trim().length < 3} onClick={() => post({ action: 'clear_caps', reason }, 'Override removed')}>Remove</Button>}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold">Strikes ({active.length} active)</div>
        {strikes.length === 0 ? <p className="text-xs text-ink-faint">None.</p> : (
          <ul className="mt-1 space-y-1 text-sm" data-testid="strike-list">
            {strikes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className={s.liftedAt ? 'text-ink-faint line-through' : ''}>{s.createdAt.slice(0, 10)} · {s.kind.replaceAll('_', ' ')}{s.reason ? ` — ${s.reason}` : ''}</span>
                {!s.liftedAt && <Button size="sm" variant="ghost" disabled={reason.trim().length < 3} onClick={() => post({ action: 'lift_strike', strikeId: s.id, reason }, 'Strike lifted')} data-testid={`lift-${s.id}`}>Lift</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
