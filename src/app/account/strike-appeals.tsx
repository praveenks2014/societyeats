'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type S = { id: number; kind: string; reason: string | null; createdAt: string; appealed: boolean };

/** Active strikes with an Appeal button (one appeal per strike). Renders nothing when there are none. */
export function StrikeAppeals() {
  const toast = useToast();
  const [rows, setRows] = useState<S[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const load = () => fetch('/api/account/strikes').then((r) => r.json()).then((d) => setRows(d.strikes ?? [])).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  if (!rows.length) return null;
  async function appeal(id: number) {
    const res = await fetch(`/api/strikes/${id}/appeal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not send the appeal', 'err');
    toast('Appeal sent. We will reply within the usual time.');
    setOpen(null);
    setReason('');
    load();
  }
  return (
    <Card className="space-y-2 p-4" data-testid="strike-appeals">
      <div className="eyebrow">STRIKES ON YOUR ACCOUNT</div>
      {rows.map((s) => (
        <div key={s.id} className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>{s.createdAt.slice(0, 10)} · {s.kind.replaceAll('_', ' ')}{s.reason ? ` — ${s.reason}` : ''}</span>
            {s.appealed ? <span className="text-xs text-ink-faint">Appeal sent</span> : <Button size="sm" variant="secondary" onClick={() => setOpen(open === s.id ? null : s.id)} data-testid={`appeal-${s.id}`}>Appeal</Button>}
          </div>
          {open === s.id && (
            <div className="mt-2 space-y-2">
              <Textarea rows={3} placeholder="Tell us what happened" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="appeal-reason" />
              <Button size="sm" disabled={reason.trim().length < 10} onClick={() => appeal(s.id)} data-testid="appeal-send">Send appeal</Button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
