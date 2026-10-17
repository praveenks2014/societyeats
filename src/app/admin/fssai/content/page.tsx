'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Step = { id?: number; lang: string; sort: number; title: string; body: string; tip: string | null; screenshotUrl: string | null };
type Lang = { code: string; label: string };

export default function FssaiContentAdmin() {
  const toast = useToast();
  const [lang, setLang] = useState('en');
  const [langs, setLangs] = useState<Lang[]>([]);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<number | null>(null);

  const load = useCallback(() => {
    setSteps(null);
    fetch(`/api/admin/fssai/content?lang=${lang}`).then((r) => r.json()).then((d) => { setSteps(d.steps); setLangs(d.languages); });
  }, [lang]);
  useEffect(load, [load]);

  const patch = (i: number, v: Partial<Step>) => setSteps((s) => s!.map((x, j) => (j === i ? { ...x, ...v } : x)));

  async function save(i: number) {
    const s = steps![i];
    const res = await fetch('/api/admin/fssai/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, lang }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Failed', 'err');
    toast('Saved ✅');
    load();
  }
  async function remove(id: number) {
    if (!confirm('Delete this step?')) return;
    await fetch(`/api/admin/fssai/content?id=${id}`, { method: 'DELETE' });
    load();
  }
  async function shot(i: number, f: File) {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('purpose', 'fssai_content');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Upload failed', 'err');
    patch(i, { screenshotUrl: d.url });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">FSSAI walkthrough content</h1>
      <p className="mt-1 text-sm text-ink-soft">The step-by-step FoSCoS guide sellers see in their filing pack. English is complete; Telugu and Hindi are editable placeholders.</p>
      <div className="mt-3 flex gap-2" role="tablist">
        {langs.map((l) => <button key={l.code} role="tab" aria-selected={lang === l.code} onClick={() => setLang(l.code)} className={`min-h-[40px] rounded-pill px-4 text-sm font-semibold ${lang === l.code ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`}>{l.label}</button>)}
      </div>
      {!steps ? <Skeleton className="mt-4 h-48 w-full" /> : (
        <div className="mt-4 space-y-4">
          {steps.map((s, i) => (
            <Card key={s.id ?? `new-${i}`} className="space-y-3 p-4">
              <div className="flex items-center gap-2"><span className="eyebrow">STEP</span><Input className="!w-16" inputMode="numeric" value={s.sort} onChange={(e) => patch(i, { sort: Number(e.target.value) || 0 })} aria-label="Order" /></div>
              <Field label="Title"><Input value={s.title} onChange={(e) => patch(i, { title: e.target.value })} /></Field>
              <Field label="Text"><Textarea rows={3} value={s.body} onChange={(e) => patch(i, { body: e.target.value })} /></Field>
              <Field label="Tip"><Textarea rows={2} value={s.tip ?? ''} onChange={(e) => patch(i, { tip: e.target.value })} /></Field>
              <div className="flex flex-wrap items-center gap-3">
                {s.screenshotUrl && <img src={s.screenshotUrl} alt="" className="h-16 rounded-lg border border-rice-line" />}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && uploadFor !== null) shot(uploadFor, f); }} />
                <Button size="sm" variant="secondary" onClick={() => { setUploadFor(i); fileRef.current?.click(); }}>🖼 {s.screenshotUrl ? 'Replace' : 'Add'} screenshot</Button>
                <span className="flex-1" />
                {s.id && <Button size="sm" variant="ghost" onClick={() => remove(s.id!)}>Delete</Button>}
                <Button size="sm" onClick={() => save(i)}>Save</Button>
              </div>
            </Card>
          ))}
          <Button variant="secondary" onClick={() => setSteps((x) => [...x!, { lang, sort: x!.length, title: '', body: '', tip: null, screenshotUrl: null }])}>+ Add step</Button>
        </div>
      )}
    </div>
  );
}
