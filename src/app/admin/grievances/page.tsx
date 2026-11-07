'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type T = { id: number; kind: string; subject: string; status: string; orderId: number | null; raiser: string; handledBy: number | null; ackOverdue: boolean; resolveOverdue: boolean; ackHoursLeft: number | null; resolveHoursLeft: number | null };
type Access = { id: number; societyName: string; city: string | null; contactName: string; email: string; status: string };
type Data = { tickets: T[]; accessRequests: Access[]; admins: { id: number; name: string }[]; overdue: number; me: number };
type Hist = { id: number; kind: string; body: string | null; at: string; actor: string | null };

const KINDS = ['all', 'grievance', 'dispute_payment', 'dispute_food', 'dispute_quality', 'chat_report', 'data_request', 'strike_appeal', 'access_request'];

export default function AdminGrievances() {
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('active');
  const [mine, setMine] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    fetch(`/api/admin/grievances?kind=${kind}&status=${status}${mine ? '&mine=1' : ''}`).then((r) => r.json()).then(setData);
  }, [kind, status, mine]);
  useEffect(load, [load]);
  if (!data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Grievances and requests</h1>
        <p className="mt-1 text-sm text-ink-soft">Everyone gets an automatic acknowledgement when they raise something. A person must pick it up within 48 hours; it is resolved within the date shown.</p>
        {data.overdue > 0 && <p className="mt-2 rounded-xl bg-chili-tint px-3 py-2 text-sm font-semibold text-chili-dark" role="alert" data-testid="overdue-banner">{data.overdue} ticket{data.overdue === 1 ? ' is' : 's are'} past a deadline.</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" className="!w-auto" data-testid="filter-kind">{KINDS.map((k) => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="!w-auto" data-testid="filter-status">{['active', 'open', 'acknowledged', 'resolved', 'all'].map((k) => <option key={k} value={k}>{k}</option>)}</Select>
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-leaf" checked={mine} onChange={(e) => setMine(e.target.checked)} />Mine</label>
      </div>
      {data.tickets.length === 0 && data.accessRequests.length === 0 ? <EmptyState emoji="✅" title="Nothing here" /> : null}
      <div className="space-y-2" data-testid="ticket-list">
        {data.tickets.map((t) => (
          <Card key={t.id} className={`p-3 ${t.ackOverdue || t.resolveOverdue ? 'border-chili' : ''}`} data-testid={`g-${t.id}`} data-overdue={t.ackOverdue || t.resolveOverdue}>
            <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
              <span><span className="font-semibold">#{t.id}</span> {t.subject}<span className="block text-xs text-ink-faint">{t.kind.replaceAll('_', ' ')} · {t.raiser}{t.orderId ? ` · order #${t.orderId}` : ''} · {t.status}{t.handledBy ? '' : ' · unassigned'}</span></span>
              <span className="flex flex-col items-end gap-1">
                {t.ackOverdue ? <Badge tone="red">not picked up</Badge> : t.ackHoursLeft != null ? <Badge tone="amber">pick up in {t.ackHoursLeft}h</Badge> : null}
                {t.resolveOverdue ? <Badge tone="red">overdue</Badge> : t.resolveHoursLeft != null ? <Badge tone="neutral">due in {Math.max(0, Math.round(t.resolveHoursLeft / 24))}d</Badge> : null}
              </span>
            </button>
            {open === t.id && <Detail id={t.id} admins={data.admins} me={data.me} onDone={load} />}
          </Card>
        ))}
        {data.accessRequests.length > 0 && (
          <>
            <h2 className="pt-2 text-lg font-bold">Access requests from other societies</h2>
            {data.accessRequests.map((a) => (
              <Card key={`a${a.id}`} className="flex items-center justify-between gap-2 p-3" data-testid={`access-${a.id}`}>
                <span><span className="font-semibold">{a.societyName}</span>{a.city ? `, ${a.city}` : ''}<span className="block text-xs text-ink-faint">{a.contactName} · {a.email} · {a.status}</span></span>
                <Link href="/admin/societies" className="text-sm font-semibold text-leaf underline">Handle</Link>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Detail({ id, admins, me, onDone }: { id: number; admins: { id: number; name: string }[]; me: number; onDone: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<{ ticket: { body: string | null; kind: string; status: string; evidenceJson: Record<string, unknown> | null }; history: Hist[] } | null>(null);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [assignee, setAssignee] = useState(String(me));
  const [busy, setBusy] = useState(false); // one request at a time, so a slow reply can never overwrite a newer one
  useEffect(() => {
    fetch(`/api/admin/grievances/${id}`).then((r) => r.json()).then(setD);
  }, [id]);
  async function post(body: Record<string, unknown>, okMsg: string, close = false) {
    setBusy(true);
    const res = await fetch(`/api/admin/grievances/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(out.error || 'Could not do that', 'err');
    toast(okMsg);
    setD(out);
    if (body.action === 'note') setNote(''); // only a saved note empties the box, never an unrelated action finishing
    if (close) onDone();
  }
  if (!d) return <Skeleton className="mt-3 h-24 w-full" />;
  const isAppeal = d.ticket.kind === 'strike_appeal';
  const done = d.ticket.status === 'resolved' || d.ticket.status === 'closed';
  return (
    <div className="mt-3 space-y-3 border-t border-rice-line pt-3 text-sm" data-testid="g-detail">
      {d.ticket.body && <p>{d.ticket.body}</p>}
      <ul className="space-y-0.5 text-xs text-ink-soft" data-testid="g-history">
        {d.history.map((h) => <li key={h.id}>{new Date(h.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })} · <strong>{h.kind}</strong>{h.actor ? ` · ${h.actor}` : ''}{h.body ? ` — ${h.body}` : ''}</li>)}
      </ul>
      {!done && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            {d.ticket.status === 'open' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => post({ action: 'acknowledge' }, 'Picked up')} data-testid="g-ack">Pick up</Button>}
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to" className="!w-auto">{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => post({ action: 'assign', assigneeId: Number(assignee) }, 'Assigned')} data-testid="g-assign">Assign</Button>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="g-note" />
            <Button size="sm" variant="secondary" disabled={busy || note.trim().length < 2} onClick={() => post({ action: 'note', body: note }, 'Note added')} data-testid="g-note-add">Add</Button>
          </div>
          {isAppeal ? (
            <Field label="Decision note"><div className="flex flex-wrap gap-2"><Input value={resolution} onChange={(e) => setResolution(e.target.value)} data-testid="g-resolution" /><Button size="sm" disabled={busy || resolution.trim().length < 3} onClick={() => post({ action: 'decide_appeal', outcome: 'lift', note: resolution }, 'Strike lifted', true)} data-testid="g-lift">Lift the strike</Button><Button size="sm" variant="secondary" disabled={busy || resolution.trim().length < 3} onClick={() => post({ action: 'decide_appeal', outcome: 'uphold', note: resolution }, 'Appeal rejected', true)}>Keep the strike</Button></div></Field>
          ) : (
            <Field label="Outcome (the person sees this)"><div className="flex gap-2"><Input value={resolution} onChange={(e) => setResolution(e.target.value)} data-testid="g-resolution" /><Button size="sm" disabled={busy || resolution.trim().length < 3} onClick={() => post({ action: 'resolve', resolution: 'resolved', note: resolution }, 'Resolved', true)} data-testid="g-resolve">Resolve</Button></div></Field>
          )}
        </>
      )}
    </div>
  );
}
