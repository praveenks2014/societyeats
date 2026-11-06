'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Doc = { slug: string; title: string; version: number; reviewStatus: string; effectiveDate: string | null; changeSummary: string | null; reconsentRequired: boolean };
type Disc = { id: string; version: number; text: string };

export default function AdminLegal() {
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [discs, setDiscs] = useState<Disc[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch('/api/admin/legal').then((r) => r.json()).then((d) => { setDocs(d.documents); setDiscs(d.disclaimers); });
  }, []);
  useEffect(load, [load]);
  if (!docs) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section>
        <h1 className="text-2xl font-bold">Legal documents</h1>
        <p className="mt-1 text-sm text-ink-soft">Every document is shown as “Draft, pending lawyer review” until you mark that version reviewed. A material change asks all users to accept again.</p>
        <div className="mt-4 space-y-3">
          {docs.map((d) => (
            <Card key={d.slug} className="p-4" data-testid={`legal-${d.slug}`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{d.title}</div>
                  <div className="text-xs text-ink-faint">/legal/{d.slug} · version {d.version}{d.effectiveDate ? ` · effective ${d.effectiveDate}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={d.reviewStatus === 'reviewed' ? 'green' : 'amber'}>{d.reviewStatus === 'reviewed' ? 'Reviewed' : 'Draft'}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setOpen(open === d.slug ? null : d.slug)}>{open === d.slug ? 'Close' : 'Edit'}</Button>
                </div>
              </div>
              {open === d.slug && <DocEditor slug={d.slug} onDone={() => { setOpen(null); load(); }} toast={toast} />}
            </Card>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-xl font-bold">Disclaimers</h2>
        <div className="mt-3 space-y-3">
          {discs.map((d) => (
            <DiscEditor key={d.id} d={d} onSaved={load} toast={toast} />
          ))}
        </div>
      </section>
    </div>
  );
}

type Toast = (t: string, k?: 'ok' | 'err') => void;

function DocEditor({ slug, onDone, toast }: { slug: string; onDone: () => void; toast: Toast }) {
  const [doc, setDoc] = useState<{ title: string; body: string; version: number; reviewStatus: string } | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [summary, setSummary] = useState('');
  const [material, setMaterial] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/admin/legal/${slug}`).then((r) => r.json()).then((d) => { setDoc(d.document); setTitle(d.document.title); setBody(d.document.body); });
  }, [slug]);
  async function post(payload: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/legal/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Failed', 'err');
    toast(okMsg);
    onDone();
  }
  if (!doc) return <Skeleton className="mt-3 h-40 w-full" />;
  return (
    <div className="mt-4 space-y-3 border-t border-rice-line pt-4">
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <div className="flex gap-2 text-xs font-semibold">
        <button className={!preview ? 'underline' : ''} onClick={() => setPreview(false)}>Markdown</button>
        <button className={preview ? 'underline' : ''} onClick={() => setPreview(true)}>Preview</button>
      </div>
      {preview ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-rice-deep p-3 text-xs" data-testid="legal-preview">{body}</pre>
      ) : (
        <Textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} data-testid="legal-body-input" />
      )}
      <Field label="What changed (shown to users who must re-accept)"><Input value={summary} onChange={(e) => setSummary(e.target.value)} data-testid="legal-summary" /></Field>
      <label className="flex min-h-[44px] items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-leaf" checked={material} onChange={(e) => setMaterial(e.target.checked)} data-testid="legal-material" />
        Material change: ask every user to accept again
      </label>
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={!summary.trim()} onClick={() => post({ action: 'publish', title, body, material, changeSummary: summary }, 'Published a new version')} data-testid="legal-publish">Publish new version</Button>
        <Button variant="secondary" loading={busy} disabled={doc.reviewStatus === 'reviewed'} onClick={() => post({ action: 'review' }, 'Marked as reviewed')} data-testid="legal-mark-reviewed">Mark this version reviewed by counsel</Button>
      </div>
    </div>
  );
}

function DiscEditor({ d, onSaved, toast }: { d: Disc; onSaved: () => void; toast: Toast }) {
  const [text, setText] = useState(d.text);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/disclaimers/${d.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(out.error || 'Failed', 'err');
    toast('Disclaimer updated');
    onSaved();
  }
  return (
    <Card className="p-3" data-testid={`disc-${d.id}`}>
      <div className="text-xs font-semibold text-ink-faint">{d.id} · version {d.version}</div>
      <Textarea rows={3} className="mt-1" value={text} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" className="mt-2" loading={busy} disabled={text.trim() === d.text} onClick={save}>Save new version</Button>
    </Card>
  );
}
