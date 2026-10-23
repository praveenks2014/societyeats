'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Thread = { id: number; sellerId: number; kitchenName: string; societyId: number | null; subject: string; lastMessage: string; lastMessageAt: string; unread: number };
type Msg = { id: number; senderRole: string; body: string; attachmentsJson: { url: string; name: string }[] | null; createdAt: string };
type Template = { id: number; title: string; body: string };
type Society = { id: number; name: string };

const when = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function AdminInbox() {
  const toast = useToast();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kitchen, setKitchen] = useState('');
  const [societyId, setSocietyId] = useState('');
  const [societies, setSocieties] = useState<Society[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<{ thread: { subject: string; sellerId: number }; messages: Msg[] } | null>(null);
  const [reply, setReply] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [files, setFiles] = useState<{ url: string; name: string }[]>([]);
  const [edit, setEdit] = useState<Template | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (unreadOnly) q.set('unread', '1');
    if (societyId) q.set('societyId', societyId);
    fetch(`/api/admin/inbox?${q}`).then((r) => r.json()).then((d) => setThreads(d.threads)).catch(() => {});
  }, [unreadOnly, societyId]);
  useEffect(load, [load]);
  useEffect(() => {
    fetch('/api/admin/inbox/templates').then((r) => r.json()).then((d) => setTemplates(d.templates));
    fetch('/api/admin/societies').then((r) => r.json()).then((d) => setSocieties(d.societies));
  }, []);
  const openThread = useCallback((id: number) => {
    fetch(`/api/admin/inbox/${id}`).then((r) => r.json()).then((d) => { setView(d); load(); });
  }, [load]);
  useEffect(() => { if (open) openThread(open); }, [open, openThread]);

  async function send() {
    const res = await fetch(`/api/admin/inbox/${open}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply, attachments: files }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Failed', 'err');
    setReply('');
    setFiles([]);
    openThread(open!);
  }
  async function attach(f: File) {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('purpose', 'attachment');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setFiles((x) => [...x, { url: d.url, name: f.name }]);
    else toast(d.error || 'Upload failed', 'err');
  }
  async function saveTemplate() {
    if (!edit) return;
    const res = await fetch('/api/admin/inbox/templates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Failed', 'err');
    setTemplates(d.templates);
    setEdit(null);
    toast('Template saved');
  }

  if (!threads) return <Skeleton className="h-64 w-full" />;
  const shown = threads.filter((t) => !kitchen || t.kitchenName.toLowerCase().includes(kitchen.toLowerCase()));

  if (open && view) {
    return (
      <div className="mx-auto max-w-2xl">
        <button className="min-h-[44px] text-sm font-semibold text-leaf underline" onClick={() => { setOpen(null); setView(null); }}>← Inbox</button>
        <h1 className="text-xl font-bold">{view.thread.subject}</h1>
        <div className="mt-4 space-y-3">
          {view.messages.map((m) => (
            <div key={m.id} className={`flex ${m.senderRole === 'admin' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${m.senderRole === 'admin' ? 'bg-leaf text-white' : 'bg-white shadow-card'}`}>
                <div className={`text-[10px] font-semibold ${m.senderRole === 'admin' ? 'text-white/70' : 'text-ink-faint'}`}>{m.senderRole === 'admin' ? 'Admin' : 'Kitchen'} · {when(m.createdAt)}</div>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.attachmentsJson?.map((a) => <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="block text-xs underline">📎 {a.name}</a>)}
              </div>
            </div>
          ))}
        </div>
        <Card className="mt-5 space-y-2 p-3">
          <Select defaultValue="" onChange={(e) => { const t = templates.find((x) => String(x.id) === e.target.value); if (t) setReply(t.body); }} aria-label="Template">
            <option value="">Insert template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
          <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply" />
          {files.length > 0 && <div className="text-xs">{files.map((f) => `📎 ${f.name}`).join('  ')}</div>}
          <div className="flex justify-between">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>📎 Attach</Button>
            <Button disabled={!reply.trim()} onClick={send}>Send</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Kitchen inbox</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-leaf" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only</label>
        <Input className="w-44" placeholder="Filter by kitchen" value={kitchen} onChange={(e) => setKitchen(e.target.value)} aria-label="Filter by kitchen" />
        <Select className="!w-auto" value={societyId} onChange={(e) => setSocietyId(e.target.value)} aria-label="Filter by society">
          <option value="">All societies</option>
          {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      {shown.length === 0 ? <div className="mt-6"><EmptyState emoji="✉️" title="No threads" body="Start one from a kitchen’s page with “Message kitchen”." /></div> : (
        <div className="mt-4 space-y-2">
          {shown.map((t) => (
            <button key={t.id} onClick={() => setOpen(t.id)} className="block min-h-[56px] w-full text-left">
              <Card className="flex items-center justify-between gap-3 p-3.5 hover:shadow-lift">
                <div className="min-w-0"><div className="truncate font-semibold">{t.kitchenName} · {t.subject}</div><div className="truncate text-xs text-ink-faint">{t.lastMessage}</div></div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-ink-faint">{when(t.lastMessageAt)}{t.unread > 0 && <Badge tone="red">{t.unread} new</Badge>}</div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <h2 className="mt-10 text-lg font-bold">Message templates</h2>
      <div className="mt-3 space-y-2">
        {templates.map((t) => (
          <Card key={t.id} className="flex items-start justify-between gap-3 p-3">
            <div className="min-w-0"><div className="font-semibold">{t.title}</div><div className="line-clamp-2 text-xs text-ink-faint">{t.body}</div></div>
            <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit</Button>
          </Card>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setEdit({ id: 0, title: '', body: '' })}>+ New template</Button>
      </div>
      {edit && (
        <Card className="mt-3 space-y-2 p-3">
          <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Title" aria-label="Template title" />
          <Textarea rows={4} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} aria-label="Template body" />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={saveTemplate} disabled={!edit.title.trim() || !edit.body.trim()}>Save</Button></div>
        </Card>
      )}
    </div>
  );
}
