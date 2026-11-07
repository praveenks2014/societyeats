'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Select, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Check = { key: string; label: string; status: 'pass' | 'flag' | 'fail'; detail: string };
type App = { sellerId: number; kitchenName: string; ownerName: string; society: string | null; state: string; ageHours: number | null; targetHours: number; overdue: boolean; checks: Check[]; blockingFails: number; flags: number };
type Tpl = { key: string; label: string; text: string };
const ICON = { pass: '✅', flag: '⚠️', fail: '❌' } as const;

export default function AdminApplications() {
  const toast = useToast();
  const [apps, setApps] = useState<App[] | null>(null);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [overdue, setOverdue] = useState(0);
  const load = useCallback(() => {
    fetch('/api/admin/applications').then((r) => r.json()).then((d) => { setApps(d.applications); setTpls(d.templates); setOverdue(d.overdue); });
  }, []);
  useEffect(load, [load]);
  if (!apps) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Kitchen applications</h1>
        <p className="mt-1 text-sm text-ink-soft">Oldest first. ✅ passes, ⚠️ needs your eyes, ❌ must be fixed before the kitchen can go live. Approving gives the Founding plan (90 days free).</p>
        {overdue > 0 && <p className="mt-2 rounded-xl bg-chili-tint px-3 py-2 text-sm font-semibold text-chili-dark" role="alert" data-testid="overdue-banner">{overdue} application{overdue === 1 ? ' is' : 's are'} past the review target.</p>}
      </div>
      {apps.length === 0 ? <EmptyState emoji="✅" title="No applications waiting" /> : apps.map((a) => <AppCard key={a.sellerId} a={a} tpls={tpls} onDone={load} toast={toast} />)}
    </div>
  );
}

function AppCard({ a, tpls, onDone, toast }: { a: App; tpls: Tpl[]; onDone: () => void; toast: (m: string, k?: 'ok' | 'err') => void }) {
  const [mode, setMode] = useState<null | 'changes' | 'reject'>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/kitchens/${a.sellerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not do that', 'err');
    toast(okMsg);
    setMode(null);
    onDone();
  }
  return (
    <Card className="p-4" data-testid={`application-${a.sellerId}`} data-overdue={a.overdue}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{a.kitchenName}</div>
          <div className="text-xs text-ink-faint">{a.ownerName} · {a.society ?? 'no society'}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={a.overdue ? 'red' : 'amber'}>{a.ageHours == null ? 'not submitted' : `${a.ageHours}h of ${a.targetHours}h`}</Badge>
          <Badge tone={a.state === 'changes_requested' ? 'neutral' : 'amber'}>{a.state.replace('_', ' ')}</Badge>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm" data-testid="checklist">
        {a.checks.map((c) => (
          <li key={c.key} className="flex gap-2" data-check={c.key} data-status={c.status}>
            <span aria-label={c.status}>{ICON[c.status]}</span>
            <span><strong>{c.label}</strong><span className="block text-xs text-ink-faint">{c.detail}</span></span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy} onClick={() => (a.blockingFails + a.flags === 0 || confirm(`${a.blockingFails} failed and ${a.flags} flagged checks. Approve anyway?`)) && act({ action: 'approve' }, 'Approved. The founding plan was granted.')} data-testid="app-approve">Approve</Button>
        <Button size="sm" variant="secondary" onClick={() => setMode('changes')} data-testid="app-changes">Request changes</Button>
        <Button size="sm" variant="danger" onClick={() => setMode('reject')} data-testid="app-reject">Reject</Button>
        <Link href={`/admin/kitchens/${a.sellerId}`} className="inline-flex min-h-[44px] items-center text-xs font-semibold text-leaf underline">Open the full file</Link>
      </div>
      {mode && (
        <div className="mt-3 space-y-2">
          {mode === 'changes' && (
            <Field label="Start from a template">
              <Select value="" onChange={(e) => setText(tpls.find((t) => t.key === e.target.value)?.text ?? text)} data-testid="app-template">
                <option value="">Choose…</option>
                {tpls.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label={mode === 'changes' ? 'Message to the kitchen' : 'Reason (the kitchen will see it)'}>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid="app-reason" />
          </Field>
          <Button size="sm" loading={busy} disabled={text.trim().length < 3} onClick={() => act({ action: mode === 'changes' ? 'request_changes' : 'reject', reason: text }, mode === 'changes' ? 'Sent to the kitchen' : 'Rejected')} data-testid="app-send">{mode === 'changes' ? 'Send' : 'Reject kitchen'}</Button>
        </div>
      )}
    </Card>
  );
}
