'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type Def = { key: string; kind: 'int' | 'number' | 'bool' | 'text' | 'enum'; label: string; hint?: string; group: string; unit?: string; min?: number; max?: number; options?: string[] };

/** Stored as integer paise / basis points; shown as ₹ / %. */
const toDisplay = (d: Def, v: unknown): string => {
  if (d.kind === 'int' && d.unit === 'paise') return String((v as number) / 100);
  if (d.kind === 'int' && d.unit === 'bps') return String((v as number) / 100);
  return String(v ?? '');
};
const fromDisplay = (d: Def, s: string): number | string | boolean => {
  if (d.kind === 'bool') return s === 'true';
  if (d.kind === 'text' || d.kind === 'enum') return s;
  const n = Number(s);
  if (d.kind === 'int' && (d.unit === 'paise' || d.unit === 'bps')) return Math.round(n * 100 * 1e6) / 1e6; // keep fractional input detectable by the server's integer check
  return n;
};
const suffix = (d: Def) => (d.unit === 'paise' || d.unit === 'rupees' ? '₹' : d.unit === 'bps' || d.unit === 'pct' ? '%' : d.unit === 'days' ? 'days' : d.unit === 'minutes' ? 'min' : d.unit === 'km' ? 'km' : '');

const TABS: { name: string; groups: string[] }[] = [
  { name: 'Fees', groups: ['Pricing', 'Subscriptions', 'Referrals'] },
  { name: 'GST & tax', groups: ['Tax'] },
  { name: 'Caps', groups: ['Provisional caps'] },
  { name: 'Timers', groups: ['Orders'] },
  { name: 'Chat', groups: ['Chat'] },
  { name: 'FSSAI', groups: ['FSSAI', 'UPI verification'] },
  { name: 'Pilot', groups: ['Pilot', 'Pilot metrics', 'Legal', 'Moderation', 'Security'] },
  { name: 'Notifications', groups: ['Notifications'] },
  { name: 'Retention', groups: ['Retention'] },
  { name: 'Feature flags', groups: ['Feature flags', 'Mall Mode'] },
];

type Hist = { id: number; key: string; label: string; oldValue: string | null; newValue: string | null; changedBy: string; changedAt: string; reason: string | null; restoredFromId: number | null };

export default function AdminSettings() {
  const [defs, setDefs] = useState<Def[] | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [mockMode, setMockMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('Fees');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<Hist[]>([]);
  const [restoreFor, setRestoreFor] = useState<number | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const toast = useToast();
  const seeded = useRef(false); // a duplicated first load (dev StrictMode) must never overwrite what the admin is typing

  const loadHistory = () => fetch('/api/admin/settings/history?limit=300').then((r) => r.json()).then((d) => setHistory(d.history ?? [])).catch(() => {});

  function apply(settings: Record<string, unknown>, ds: Def[]) {
    const f = Object.fromEntries(ds.map((d) => [d.key, toDisplay(d, settings[d.key])]));
    setForm(f);
    setInitial(f);
  }

  useEffect(() => {
    loadHistory();
    fetch('/api/admin/settings').then((r) => r.json()).then((d) => {
      setDefs(d.defs);
      setMockMode(d.mockMode);
      if (seeded.current) return;
      seeded.current = true;
      apply(d.settings, d.defs);
    });
  }, []);

  const groups = useMemo(() => {
    const wanted = TABS.find((t) => t.name === tab)?.groups ?? [];
    const g = new Map<string, Def[]>();
    for (const d of defs ?? []) if (wanted.includes(d.group)) g.set(d.group, [...(g.get(d.group) ?? []), d]);
    return [...g.entries()];
  }, [defs, tab]);
  const tabKeys = useMemo(() => new Set((defs ?? []).filter((d) => (TABS.find((t) => t.name === tab)?.groups ?? []).includes(d.group)).map((d) => d.key)), [defs, tab]);
  const tabHistory = history.filter((h) => tabKeys.has(h.key)).slice(0, 25);
  const pending = defs ? defs.filter((d) => form[d.key] !== initial[d.key]) : [];

  async function restore(id: number) {
    const res = await fetch('/api/admin/settings/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ historyId: id, reason: restoreReason }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not restore', 'err');
    toast('Restored');
    setRestoreFor(null);
    setRestoreReason('');
    const fresh = await fetch('/api/admin/settings').then((r) => r.json());
    apply(fresh.settings, fresh.defs);
    loadHistory();
  }

  async function save() {
    if (!defs) return;
    const changed = defs.filter((d) => form[d.key] !== initial[d.key]);
    if (changed.length === 0) return toast('Nothing changed');
    setBusy(true);
    if (reason.trim().length < 3) {
      setBusy(false);
      return toast('Say why you are changing this', 'err');
    }
    const body = { ...Object.fromEntries(changed.map((d) => [d.key, fromDisplay(d, form[d.key])])), reason: reason.trim() };
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(data.error || 'Could not save', 'err');
    apply(data.settings, defs);
    setReason('');
    loadHistory();
    toast('Settings saved ✅ (new orders use them; past orders keep their snapshot)');
  }

  if (!defs) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Badge tone={mockMode ? 'amber' : 'green'}>{mockMode ? 'MOCK MODE' : 'LIVE MODE'}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Money is shown in ₹ and %, stored as integer paise and basis points. Every field is bounds-checked. The rates in force are snapshotted on each order and subscription payment — changing a setting never alters past records.
      </p>

      <div className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Settings groups" data-testid="settings-tabs">
        {TABS.map((t) => (
          <button key={t.name} role="tab" aria-selected={tab === t.name} onClick={() => setTab(t.name)} data-testid={`tab-${t.name}`} className={`min-h-[44px] shrink-0 rounded-pill px-3.5 text-sm font-semibold ${tab === t.name ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`}>
            {t.name}
          </button>
        ))}
      </div>
      {pending.length > 0 && <p className="mt-2 text-xs text-turmeric-deep" data-testid="unsaved">Unsaved changes in: {pending.map((d) => d.label).join(', ')}</p>}

      <div className="mt-6 space-y-6">
        {groups.map(([group, ds]) => (
          <Card key={group} className="space-y-4 p-4" data-testid={`settings-${group}`}>
            <div className="eyebrow">{group.toUpperCase()}</div>
            {group === 'Tax' && (
              <p className="rounded-xl bg-turmeric-tint px-3 py-2 text-xs font-medium text-turmeric-deep" role="note">
                ⚠️ Confirm GST treatment with your CA before going live.
              </p>
            )}
            {ds.map((d) => (
              <Field key={d.key} label={d.label + (suffix(d) ? ` (${suffix(d)})` : '')} hint={d.hint}>
                {d.kind === 'bool' ? (
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" checked={form[d.key] === 'true'} onChange={(e) => setForm((f) => ({ ...f, [d.key]: String(e.target.checked) }))} className="h-5 w-5 accent-leaf" />
                    {form[d.key] === 'true' ? 'On' : 'Off'}
                  </label>
                ) : d.kind === 'enum' ? (
                  <Select value={form[d.key]} onChange={(e) => setForm((f) => ({ ...f, [d.key]: e.target.value }))}>
                    {d.options!.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={form[d.key] ?? ''}
                    inputMode={d.kind === 'text' ? 'text' : 'decimal'}
                    onChange={(e) => setForm((f) => ({ ...f, [d.key]: e.target.value }))}
                    data-testid={`setting-${d.key}`}
                  />
                )}
              </Field>
            ))}
          </Card>
        ))}
      </div>

      <Card className="mt-6 space-y-3 p-4" data-testid="settings-history">
        <div className="eyebrow">RECENT CHANGES · {tab.toUpperCase()}</div>
        {tabHistory.length === 0 ? <p className="text-xs text-ink-faint">No changes recorded yet.</p> : (
          <ul className="space-y-2 text-sm">
            {tabHistory.map((h) => (
              <li key={h.id} data-testid={`history-${h.id}`}>
                <div><strong>{h.label}</strong>: <span className="text-chili-dark line-through">{h.oldValue ?? '—'}</span> → <span className="text-leaf">{h.newValue ?? '—'}</span></div>
                <div className="text-xs text-ink-faint">{new Date(h.changedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} · {h.changedBy}{h.reason ? ` · ${h.reason}` : ''}</div>
                {h.oldValue != null && (
                  restoreFor === h.id ? (
                    <div className="mt-1 flex gap-2">
                      <Input placeholder="Why restore?" value={restoreReason} onChange={(e) => setRestoreReason(e.target.value)} data-testid="restore-reason" />
                      <Button size="sm" disabled={restoreReason.trim().length < 3} onClick={() => restore(h.id)} data-testid="restore-confirm">Restore {h.oldValue}</Button>
                    </div>
                  ) : (
                    <button className="min-h-[44px] text-xs font-semibold text-leaf underline" onClick={() => setRestoreFor(h.id)} data-testid={`restore-${h.id}`}>Restore the previous value ({h.oldValue})</button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Field label="Why are you changing this? (kept in the history)">
        <Input className="mt-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. pilot discount for the first month" data-testid="settings-reason" />
      </Field>

      <div className="sticky bottom-20 mt-6">
        <Button size="lg" className="w-full" loading={busy} onClick={save} data-testid="save-settings">
          Save settings
        </Button>
      </div>
    </div>
  );
}
