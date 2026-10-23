'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

export default function PaymentDetailsPage() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [vpa, setVpa] = useState('');
  const [name, setName] = useState('');
  const [upiNow, setUpiNow] = useState(true);
  const [atPickup, setAtPickup] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/seller/payment-details').then((r) => r.json()).then((d) => {
      setVpa(d.upiVpa ?? '');
      setName(d.upiName ?? '');
      setUpiNow(d.acceptsUpiNow);
      setAtPickup(d.acceptsPayAtPickup);
      setLoaded(true);
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/seller/payment-details', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upiVpa: vpa.trim() || null, upiName: name.trim() || null, acceptsUpiNow: upiNow, acceptsPayAtPickup: atPickup }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not save', 'err');
    toast('Payment details saved ✅');
  }

  if (!loaded) return <Skeleton className="mx-auto h-64 w-full max-w-lg" />;
  return (
    <form onSubmit={save} className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold">How buyers pay you</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Buyers pay you <strong>directly</strong> for the food. PadosiPlate never touches it. We only need a UPI ID — no bank account number or PAN.
        </p>
      </div>
      <Card className="space-y-3 p-4">
        <label className="flex min-h-[44px] items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-leaf" checked={upiNow} onChange={(e) => setUpiNow(e.target.checked)} />
          <span>
            <span className="font-semibold">UPI now</span>
            <span className="block text-xs text-ink-faint">The buyer pays your UPI ID right after placing the order, then taps “I’ve paid”. You confirm when it lands.</span>
          </span>
        </label>
        <label className="flex min-h-[44px] items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-leaf" checked={atPickup} onChange={(e) => setAtPickup(e.target.checked)} />
          <span>
            <span className="font-semibold">Pay at pickup</span>
            <span className="block text-xs text-ink-faint">UPI or cash at handover. You record “paid at handover” before entering the OTP.</span>
          </span>
        </label>
      </Card>
      {upiNow && (
        <Card className="space-y-4 p-4">
          <Field label="UPI ID (VPA)" hint="Shown to a buyer only inside their own order. Example: lakshmi@okhdfcbank">
            <Input value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@bank" autoCapitalize="none" autoCorrect="off" data-testid="vpa" />
          </Field>
          <Field label="Name on the UPI account" hint="Buyers see this in their UPI app so they know it’s you.">
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="vpa-name" />
          </Field>
        </Card>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy} data-testid="save-payment">
        Save payment details
      </Button>
    </form>
  );
}
