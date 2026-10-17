'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui';

type Mail = { id: number; toEmail: string; subject: string; bodyText: string; kind: string; status: string; error: string | null; createdAt: string };

export default function Outbox() {
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/admin/outbox').then((r) => r.json()).then((d) => setMails(d.emails)).catch(() => {});
  }, []);
  if (!mails) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Email outbox</h1>
      <p className="mt-1 text-sm text-ink-soft">Every email the platform sends. In mock mode this table <em>is</em> the delivery — nothing leaves the server.</p>
      {mails.length === 0 ? <div className="mt-6"><EmptyState emoji="📭" title="No emails yet" /></div> : (
        <div className="mt-4 space-y-2">
          {mails.map((m) => (
            <Card key={m.id} className="p-3">
              <button className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === m.id ? null : m.id)}>
                <div className="min-w-0"><div className="truncate text-sm font-semibold">{m.subject}</div><div className="truncate text-xs text-ink-faint">to {m.toEmail} · {m.kind} · {new Date(m.createdAt).toLocaleString('en-IN')}</div></div>
                <Badge tone={m.status === 'sent' ? 'green' : m.status === 'mock' ? 'amber' : 'red'}>{m.status}</Badge>
              </button>
              {open === m.id && <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-rice p-3 text-xs">{m.bodyText}{m.error ? `\n\nERROR: ${m.error}` : ''}</pre>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
