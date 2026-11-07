'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Soc = { id: number; name: string };
type H = { id: number; title: string; kind: string; recipients: number; skippedNoOptIn: number; createdAt: string; audienceJson: { type: string } };

export default function AdminBroadcast() {
  const toast = useToast();
  const [type, setType] = useState<'all' | 'kitchens' | 'societies'>('all');
  const [kind, setKind] = useState<'service' | 'marketing'>('service');
  const [societies, setSocieties] = useState<Soc[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<{ recipients: number; skippedNoOptIn: number } | null>(null);
  const [history, setHistory] = useState<H[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(() => {
    fetch('/api/admin/broadcast').then((r) => r.json()).then((d) => setHistory(d.history));
  }, []);
  useEffect(() => {
    loadHistory();
    fetch('/api/admin/societies').then((r) => r.json()).then((d) => setSocieties((d.societies ?? []).map((s: Soc) => ({ id: s.id, name: s.name }))));
  }, [loadHistory]);
  useEffect(() => setPreview(null), [type, kind, picked]);

  const audienceBody = type === 'societies' ? { type, societyIds: picked } : { type };
  async function doPreview() {
    const q = new URLSearchParams({ type, kind, ...(type === 'societies' ? { societyIds: picked.join(',') } : {}) });
    const res = await fetch(`/api/admin/broadcast?${q}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not preview', 'err');
    setPreview(d);
  }
  async function send() {
    if (!preview) return;
    setBusy(true);
    const res = await fetch('/api/admin/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audience: audienceBody, kind, title, body, expectedRecipients: preview.recipients }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not send', 'err');
    toast(`Sent to ${d.recipients} people`);
    setTitle('');
    setBody('');
    setPreview(null);
    loadHistory();
  }
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Broadcast</h1>
        <p className="mt-1 text-sm text-ink-soft">A <strong>service message</strong> (outage, rule change, safety) reaches everyone you choose and is labelled “Service message”. An <strong>offer</strong> reaches only people who opted in.</p>
      </div>
      <Card className="space-y-3 p-4">
        <Field label="Who">
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} data-testid="bc-audience">
            <option value="all">Everyone</option>
            <option value="kitchens">All kitchens</option>
            <option value="societies">Chosen societies</option>
          </Select>
        </Field>
        {type === 'societies' && (
          <div className="flex flex-wrap gap-1.5">
            {societies.map((s) => (
              <button key={s.id} type="button" aria-pressed={picked.includes(s.id)} onClick={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} className={`min-h-[44px] rounded-pill px-3 text-xs font-semibold ${picked.includes(s.id) ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`} data-testid={`bc-soc-${s.id}`}>{s.name}</button>
            ))}
          </div>
        )}
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="bc-kind">
            <option value="service">Service message</option>
            <option value="marketing">Offer / news (opted-in only)</option>
          </Select>
        </Field>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} data-testid="bc-title" /></Field>
        <Field label="Message"><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid="bc-body" /></Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={doPreview} disabled={type === 'societies' && picked.length === 0} data-testid="bc-preview">Preview recipients</Button>
          {preview && <span className="text-sm" data-testid="bc-count">Will reach <strong>{preview.recipients}</strong> {preview.recipients === 1 ? 'person' : 'people'}{preview.skippedNoOptIn ? ` (${preview.skippedNoOptIn} skipped: no opt-in)` : ''}</span>}
        </div>
        {preview && (
          <div className="rounded-xl bg-rice-deep p-3 text-sm" data-testid="bc-preview-card">
            <div className="font-semibold">{kind === 'service' ? 'Service message: ' : ''}{title || '(no title yet)'}</div>
            <div className="mt-1 whitespace-pre-wrap text-ink-soft">{body || '(no message yet)'}</div>
          </div>
        )}
        <Button loading={busy} disabled={!preview || preview.recipients === 0 || title.trim().length < 3 || body.trim().length < 10} onClick={send} data-testid="bc-send">Send to {preview?.recipients ?? 0}</Button>
      </Card>
      <section>
        <h2 className="mb-2 text-lg font-bold">Sent</h2>
        {!history ? <Skeleton className="h-24 w-full" /> : history.length === 0 ? <p className="text-sm text-ink-faint">Nothing sent yet.</p> : (
          <div className="space-y-2">
            {history.map((h) => (
              <Card key={h.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span><span className="font-semibold">{h.title}</span><span className="block text-xs text-ink-faint">{new Date(h.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} · {h.audienceJson.type} · {h.recipients} people</span></span>
                <Badge tone={h.kind === 'service' ? 'amber' : 'neutral'}>{h.kind}</Badge>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
