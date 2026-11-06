'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, Field, Input, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

/** Shown to visitors and non-members while `pilotSocietiesOnly` is on. */
export function InviteOnly({ signedIn }: { signedIn: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({ societyName: '', city: '', contactName: '', email: '', phone: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/access-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, phone: form.phone || undefined, city: form.city || undefined, message: form.message || undefined }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not send the request', 'err');
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-md pt-10 text-center" data-testid="invite-only">
      <div className="text-5xl" aria-hidden>🍛</div>
      <h1 className="mt-3 text-2xl font-bold">PadosiPlate is invite-only during the pilot</h1>
      <p className="mt-2 text-sm text-ink-soft">We are starting with a few gated communities. If you live in one, use the invite link shared in your society&apos;s WhatsApp group.</p>
      <div className="mt-5 flex justify-center gap-3">
        {!signedIn && <Link href="/login" className="inline-flex min-h-[44px] items-center rounded-xl border border-rice-line px-5 text-sm font-semibold">Log in</Link>}
      </div>
      <Card className="mt-6 p-4 text-left">
        <div className="eyebrow">REQUEST ACCESS FOR MY SOCIETY</div>
        {sent ? (
          <p className="mt-3 text-sm text-leaf" role="status" data-testid="access-sent">Thanks! We&apos;ll write to you when your society is ready.</p>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-3">
            <Field label="Society name"><Input value={form.societyName} onChange={(e) => set('societyName', e.target.value)} required data-testid="ar-society" /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="Your name"><Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} required data-testid="ar-name" /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required data-testid="ar-email" /></Field>
            <Field label="Phone (optional)"><Input inputMode="numeric" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Anything else? (optional)"><Textarea rows={2} value={form.message} onChange={(e) => set('message', e.target.value)} /></Field>
            <Button type="submit" className="w-full" size="lg" loading={busy} data-testid="ar-submit">Request access</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
