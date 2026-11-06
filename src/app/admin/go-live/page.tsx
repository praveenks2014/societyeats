'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, Field, Input, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type Fix = { kind: 'setting'; keys: string[] } | { kind: 'secret'; names: string[] } | { kind: 'link'; href: string; text: string } | { kind: 'info'; text: string };
type Row = { key: string; label: string; status: 'ok' | 'missing' | 'warn'; blocking: boolean; fix: Fix; detail?: string };
type Def = { key: string; kind: string; label: string; hint?: string; options?: string[] };

export default function GoLivePage() {
  const toast = useToast();
  const [data, setData] = useState<{ rows: Row[]; blockers: Row[]; mockMode: boolean } | null>(null);
  const [defs, setDefs] = useState<Record<string, Def>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const [g, s] = await Promise.all([fetch('/api/admin/go-live').then((r) => r.json()), fetch('/api/admin/settings').then((r) => r.json())]);
    setData(g);
    setDefs(Object.fromEntries((s.defs as Def[]).map((d) => [d.key, d])));
    setValues(Object.fromEntries(Object.entries(s.settings as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function save(keys: string[]) {
    const patch = { ...Object.fromEntries(keys.map((k) => [k, values[k]])), reason: 'Go-live checklist' };
    const res = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not save', 'err');
    toast('Saved');
    load();
  }
  if (!data) return <Skeleton className="h-64 w-full" />;
  const ready = data.blockers.length === 0;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Go-live checklist</h1>
        <p className="mt-1 text-sm text-ink-soft">Real money stays off (MOCK_MODE) until every red item is done. This page and the live-mode guard use the same list.</p>
        <p className={`mt-3 rounded-xl px-4 py-3 text-sm font-semibold ${ready ? 'bg-leaf-tint text-leaf' : 'bg-chili-tint text-chili-dark'}`} data-testid="golive-summary" role="status">
          {ready ? 'All blocking items are done.' : `${data.blockers.length} blocking item${data.blockers.length === 1 ? '' : 's'} left.`} Currently {data.mockMode ? 'in mock mode' : 'LIVE'}.
        </p>
      </div>
      {data.rows.map((r) => (
        <Card key={r.key} className="p-4" data-testid={`golive-${r.key}`} data-status={r.status}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{r.label}</div>
              {r.detail && <div className="mt-0.5 text-xs text-ink-faint">{r.detail}</div>}
            </div>
            <Badge tone={r.status === 'ok' ? 'green' : r.status === 'warn' ? 'amber' : 'red'}>{r.status === 'ok' ? 'Done' : r.status === 'warn' ? 'Recommended' : 'Missing'}</Badge>
          </div>
          {r.status !== 'ok' && r.fix.kind === 'setting' && (
            <div className="mt-3 space-y-2">
              {r.fix.keys.map((k) => {
                const d = defs[k];
                if (!d) return null;
                return (
                  <Field key={k} label={d.label} hint={d.hint}>
                    {d.kind === 'enum' ? (
                      <Select value={values[k] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}>
                        {d.options?.map((o) => <option key={o}>{o}</option>)}
                      </Select>
                    ) : (
                      <Input value={values[k] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} data-testid={`golive-input-${k}`} />
                    )}
                  </Field>
                );
              })}
              <Button size="sm" onClick={() => save((r.fix as { keys: string[] }).keys)} data-testid={`golive-save-${r.key}`}>Save</Button>
            </div>
          )}
          {r.status !== 'ok' && r.fix.kind === 'secret' && <p className="mt-3 rounded-xl bg-rice-deep px-3 py-2 text-xs">Add in Replit Secrets: <code>{r.fix.names.join(', ')}</code>, then redeploy.</p>}
          {r.status !== 'ok' && r.fix.kind === 'link' && <Link href={r.fix.href} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-leaf underline">{r.fix.text}</Link>}
          {r.status !== 'ok' && r.fix.kind === 'info' && <p className="mt-3 rounded-xl bg-rice-deep px-3 py-2 text-xs">{r.fix.text}</p>}
        </Card>
      ))}
    </div>
  );
}
