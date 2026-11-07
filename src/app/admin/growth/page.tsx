'use client';
import { useState } from 'react';
import { Button, Card } from '@/components/ui';

/** Featured placements and campaigns. Both are off until their flags are switched on in Settings. */
export default function GrowthPage() {
  const [p, setP] = useState({ sellerId: '', societyId: '', startsOn: '', endsOn: '' });
  const [c, setC] = useState({ slug: '', title: '', body: '', startsOn: '', endsOn: '', sellerIds: '' });
  const [msg, setMsg] = useState('');
  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    const j = await r.json();
    setMsg(r.ok ? 'Saved.' : j.error ?? 'Failed');
  }
  return (
    <div className="mx-auto max-w-lg space-y-4 pt-6" data-testid="growth-page">
      <h1 className="text-2xl font-bold">Featured and campaigns</h1>
      <Card className="space-y-2 p-4 text-sm">
        <h2 className="font-semibold">Featured placement (shown as “Sponsored”, never in ranking)</h2>
        {(['sellerId', 'societyId', 'startsOn', 'endsOn'] as const).map((k) => (
          <input key={k} className="input w-full" placeholder={k} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
        ))}
        <Button onClick={() => post('/api/admin/featured', { sellerId: Number(p.sellerId), societyId: Number(p.societyId), startsOn: p.startsOn, endsOn: p.endsOn })}>Add placement</Button>
      </Card>
      <Card className="space-y-2 p-4 text-sm">
        <h2 className="font-semibold">Campaign page</h2>
        {(['slug', 'title', 'body', 'startsOn', 'endsOn', 'sellerIds'] as const).map((k) => (
          <input key={k} className="input w-full" placeholder={k === 'sellerIds' ? 'sellerIds (comma separated)' : k} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
        ))}
        <Button onClick={() => post('/api/admin/campaigns', { ...c, sellerIds: c.sellerIds.split(',').map((x) => Number(x.trim())).filter(Boolean) })}>Create campaign</Button>
      </Card>
      {msg ? <p className="text-xs" role="status">{msg}</p> : null}
    </div>
  );
}
