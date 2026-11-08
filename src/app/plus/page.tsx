'use client';
import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { launchRazorpay } from '@/components/razorpay';
import { BRAND } from '@/config/brand';

type Info = { active: boolean; endsAt: string | null; pricePaise: number; discountBps: number; capPaise: number };

export default function PlusPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [off, setOff] = useState(false);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState('');
  async function load() {
    const r = await fetch('/api/plus');
    if (r.status === 404) return setOff(true);
    if (r.ok) setInfo(await r.json());
  }
  useEffect(() => { void load(); }, []);
  async function buy() {
    setMsg('');
    const r = await fetch('/api/plus', { method: 'POST', body: JSON.stringify({ consent }) });
    const j = await r.json();
    if (!r.ok) return setMsg(j.error ?? 'Could not start');
    if (j.mode === 'mock') {
      const c = await fetch('/api/plus/complete', { method: 'POST', body: JSON.stringify({ membershipId: j.membershipId, mock: true }) });
      setMsg(c.ok ? 'Plus is active.' : 'Payment failed');
      return void load();
    }
    launchRazorpay({
      keyId: j.keyId,
      razorpayOrderId: j.razorpayOrderId,
      amountInPaise: j.amountInPaise,
      description: `${BRAND.name} Plus: one month`,
      onSuccess: async (resp) => {
        const c = await fetch('/api/plus/complete', { method: 'POST', body: JSON.stringify({ membershipId: j.membershipId, ...resp }) });
        setMsg(c.ok ? 'Plus is active.' : 'We could not confirm that payment. If money left your account it will be refunded.');
        void load();
      },
      onDismiss: () => setMsg('Payment not completed.'),
      onLoadError: () => setMsg('Could not open the payment sheet.'),
    });
  }
  if (off) return <div className="mx-auto max-w-lg pt-6"><h1 className="text-2xl font-bold">{BRAND.name} Plus</h1><p className="mt-2 text-sm text-ink-soft">Not available yet.</p></div>;
  if (!info) return <div className="pt-6 text-sm text-ink-faint">Loading…</div>;
  return (
    <div className="mx-auto max-w-lg pt-6" data-testid="plus-page">
      <h1 className="text-2xl font-bold">{BRAND.name} Plus</h1>
      <Card className="mt-4 p-4 text-sm">
        <p>₹{(info.pricePaise / 100).toFixed(0)} for one month. Takes {(info.discountBps / 100).toFixed(0)}% off the platform fee (up to ₹{(info.capPaise / 100).toFixed(0)} a month). It does not renew by itself.</p>
        {info.active ? <p className="mt-2 font-semibold" data-testid="plus-active">Active until {info.endsAt?.slice(0, 10)}</p> : null}
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I understand and want to buy one month.</label>
        <Button className="mt-3" disabled={!consent} onClick={buy}>Buy one month</Button>
        {msg ? <p className="mt-2 text-xs" role="status">{msg}</p> : null}
      </Card>
    </div>
  );
}
