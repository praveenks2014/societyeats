'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';

export function TwoFactorClient({ enrolled, next }: { enrolled: boolean; next: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  async function start() {
    setBusy(true);
    const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not start setup', 'err');
    setSetup(d);
  }
  async function enable() {
    setBusy(true);
    const res = await fetch('/api/auth/2fa/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'That code is not right', 'err');
    setRecovery(d.recoveryCodes);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/2fa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'That code is wrong', 'err');
    router.push(next);
    router.refresh();
  }

  if (recovery) {
    return (
      <div className="mx-auto mt-10 max-w-md">
        <h1 className="text-2xl font-bold">Save your recovery codes</h1>
        <p className="mt-1 text-sm text-ink-soft">Each code works once if you lose your phone. They are shown only now — store them somewhere safe (not on the same phone).</p>
        <Card className="mt-4 p-4"><ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="recovery-codes">{recovery.map((c) => <li key={c}>{c}</li>)}</ul></Card>
        <Button className="mt-4 w-full" size="lg" onClick={() => { router.push(next); router.refresh(); }} data-testid="recovery-saved">I&apos;ve saved them — continue</Button>
      </div>
    );
  }

  if (!enrolled) {
    return (
      <div className="mx-auto mt-10 max-w-md">
        <h1 className="text-2xl font-bold">Set up two-factor sign-in</h1>
        <p className="mt-1 text-sm text-ink-soft">Admin access needs a code from an authenticator app (Google Authenticator, Authy, 1Password…) on top of your password.</p>
        {!setup ? (
          <Button className="mt-5 w-full" size="lg" loading={busy} onClick={start} data-testid="start-2fa">Start setup</Button>
        ) : (
          <Card className="mt-5 space-y-4 p-4">
            <div className="flex justify-center rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <p className="text-center text-xs text-ink-soft">Can&apos;t scan? Enter this key: <code className="font-mono font-semibold" data-testid="totp-secret">{setup.secret}</code></p>
            <Field label="6-digit code from the app"><Input inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} data-testid="totp-code" autoComplete="one-time-code" /></Field>
            <Button className="w-full" size="lg" loading={busy} disabled={code.replace(/\D/g, '').length !== 6} onClick={enable} data-testid="enable-2fa">Turn on two-factor</Button>
          </Card>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="mx-auto mt-10 max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Two-factor code</h1>
      <p className="text-sm text-ink-soft">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" data-testid="totp-code" required /></Field>
      <Button type="submit" size="lg" className="w-full" loading={busy} data-testid="verify-2fa">Continue</Button>
    </form>
  );
}
