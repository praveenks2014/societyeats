'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Thread = { id: number; subject: string; lastMessage: string; lastMessageAt: string; unread: number };
type Msg = { id: number; senderRole: string; body: string; attachmentsJson: { url: string; name: string }[] | null; createdAt: string };

const when = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export default function SellerInbox() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<{ thread: { subject: string }; messages: Msg[] } | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<{ url: string; name: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const loadList = useCallback(() => {
    fetch('/api/seller/inbox').then((r) => r.json()).then((d) => setThreads(d.threads)).catch(() => {});
  }, []);
  const loadThread = useCallback((id: number) => {
    fetch(`/api/seller/inbox/${id}`).then((r) => r.json()).then((d) => { setView(d); loadList(); }).catch(() => {});
  }, [loadList]);
  useEffect(loadList, [loadList]);
  useEffect(() => { if (open) loadThread(open); }, [open, loadThread]);

  async function attach(f: File) {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('purpose', 'attachment');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Upload failed', 'err');
    setFiles((x) => [...x, { url: d.url, name: f.name }]);
  }

  async function send() {
    if (!open) return;
    setBusy(true);
    const res = await fetch(`/api/seller/inbox/${open}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply, attachments: files }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not send', 'err');
    setReply('');
    setFiles([]);
    loadThread(open);
  }

  if (!threads) return <Skeleton className="mx-auto h-48 w-full max-w-2xl" />;

  if (open && view) {
    return (
      <div className="mx-auto max-w-2xl">
        <button className="min-h-[44px] text-sm font-semibold text-leaf underline" onClick={() => { setOpen(null); setView(null); }}>← Inbox</button>
        <h1 className="mt-1 text-xl font-bold">{view.thread.subject}</h1>
        <div className="mt-4 space-y-3" aria-live="polite">
          {view.messages.map((m) => (
            <div key={m.id} className={`flex ${m.senderRole === 'seller' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${m.senderRole === 'seller' ? 'bg-leaf text-white' : 'bg-white shadow-card'}`}>
                <div className={`text-[10px] font-semibold ${m.senderRole === 'seller' ? 'text-white/70' : 'text-ink-faint'}`}>{m.senderRole === 'seller' ? 'You' : 'PadosiPlate'} · {when(m.createdAt)}</div>
                <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                {m.attachmentsJson?.map((a) => (
                  <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="mt-1 block text-xs underline">📎 {a.name}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Card className="mt-5 p-3">
          <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" aria-label="Reply" data-testid="reply-box" />
          {files.length > 0 && <div className="mt-1 text-xs text-ink-soft">{files.map((f) => `📎 ${f.name}`).join('  ')}</div>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>📎 Attach</Button>
            <Button loading={busy} disabled={!reply.trim()} onClick={send} data-testid="send-reply">Send reply</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Inbox</h1>
      <p className="mt-1 text-sm text-ink-soft">Messages from the PadosiPlate team about your kitchen. Replies are emailed to us too.</p>
      {threads.length === 0 ? (
        <div className="mt-6"><EmptyState emoji="✉️" title="No messages" body="Anything we need from you will show up here." /></div>
      ) : (
        <div className="mt-4 space-y-2">
          {threads.map((t) => (
            <button key={t.id} onClick={() => setOpen(t.id)} className="block min-h-[56px] w-full text-left" data-testid={`thread-${t.id}`}>
              <Card className="flex items-center justify-between gap-3 p-3.5 transition-shadow hover:shadow-lift">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{t.subject}</div>
                  <div className="truncate text-xs text-ink-faint">{t.lastMessage}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-ink-faint">
                  {when(t.lastMessageAt)}
                  {t.unread > 0 && <Badge tone="red">{t.unread} new</Badge>}
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
