'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';

type Req = { id: number; sellerId: number; description: string; portions: number; forDate: string; status: string; quoteNote: string | null; orderId: number | null };

export default function BulkPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Req[]>([]);
  const [off, setOff] = useState(false);
  const [f, setF] = useState({ sellerId: '', description: '', portions: '15', forDate: '' });
  const [msg, setMsg] = useState('');
  async function load() {
    const r = await fetch('/api/bulk');
    if (r.ok) setRows((await r.json()).requests);
  }
  useEffect(() => { void load(); }, []);
  async function send() {
    const r = await fetch('/api/bulk', { method: 'POST', body: JSON.stringify({ sellerId: Number(f.sellerId), description: f.description, portions: Number(f.portions), forDate: f.forDate }) });
    const j = await r.json();
    if (r.status === 404) setOff(true);
    setMsg(r.ok ? 'Sent to the kitchen.' : j.error ?? 'Could not send');
    if (r.ok) void load();
  }
  async function act(id: number, action: 'accept' | 'cancel') {
    const r = await fetch(`/api/bulk/${id}`, { method: 'POST', body: JSON.stringify({ action }) });
    const j = await r.json();
    if (r.ok && action === 'accept') router.push(`/orders/${j.orderId}`);
    else void load();
  }
  return (
    <div className="mx-auto max-w-lg pt-6" data-testid="bulk-page">
      <h1 className="text-2xl font-bold">Party and bulk orders</h1>
      {off ? <p className="mt-2 text-sm text-ink-soft">Not available yet.</p> : null}
      <Card className="mt-4 space-y-2 p-4 text-sm">
        <input className="input w-full" placeholder="Kitchen id" value={f.sellerId} onChange={(e) => setF({ ...f, sellerId: e.target.value })} />
        <textarea className="input w-full" placeholder="What do you need?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <input className="input w-full" type="number" value={f.portions} onChange={(e) => setF({ ...f, portions: e.target.value })} />
        <input className="input w-full" type="date" value={f.forDate} onChange={(e) => setF({ ...f, forDate: e.target.value })} />
        <Button onClick={send}>Ask for a quote</Button>
        {msg ? <p className="text-xs" role="status">{msg}</p> : null}
      </Card>
      <div className="mt-4 space-y-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-3 text-sm">
            <div className="font-semibold">{r.portions} portions · {r.forDate} · {r.status}</div>
            {r.quoteNote ? <div className="text-xs text-ink-soft">{r.quoteNote}</div> : null}
            {r.status === 'quoted' ? <Button className="mt-2" onClick={() => act(r.id, 'accept')}>Accept quote</Button> : null}
            {['requested', 'quoted'].includes(r.status) ? <Button variant="ghost" className="mt-2" onClick={() => act(r.id, 'cancel')}>Cancel</Button> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
