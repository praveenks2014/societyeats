'use client';

import { useEffect, useMemo, useState } from 'react';
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

export default function AdminSettings() {
  const [defs, setDefs] = useState<Def[] | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [mockMode, setMockMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function apply(settings: Record<string, unknown>, ds: Def[]) {
    const f = Object.fromEntries(ds.map((d) => [d.key, toDisplay(d, settings[d.key])]));
    setForm(f);
    setInitial(f);
  }

  useEffect(() => {
    fetch('/api/admin/settings').then((r) => r.json()).then((d) => {
      setDefs(d.defs);
      setMockMode(d.mockMode);
      apply(d.settings, d.defs);
    });
  }, []);

  const groups = useMemo(() => {
    const g = new Map<string, Def[]>();
    for (const d of defs ?? []) g.set(d.group, [...(g.get(d.group) ?? []), d]);
    return [...g.entries()];
  }, [defs]);

  async function save() {
    if (!defs) return;
    const changed = defs.filter((d) => form[d.key] !== initial[d.key]);
    if (changed.length === 0) return toast('Nothing changed');
    setBusy(true);
    const body = Object.fromEntries(changed.map((d) => [d.key, fromDisplay(d, form[d.key])]));
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(data.error || 'Could not save', 'err');
    apply(data.settings, defs);
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

      <div className="sticky bottom-20 mt-6">
        <Button size="lg" className="w-full" loading={busy} onClick={save} data-testid="save-settings">
          Save settings
        </Button>
      </div>
    </div>
  );
}
