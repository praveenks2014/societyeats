'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, next }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not change password', 'err');
      return;
    }
    toast('Password changed');
    router.push(forced ? '/admin' : '/');
    router.refresh();
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">{forced ? 'Set a new password' : 'Change password'}</h1>
      {forced && (
        <p className="mt-2 rounded-xl bg-turmeric-tint px-3 py-2 text-sm text-ink-soft" role="alert">
          You signed in with a one-time password. Choose your own before continuing.
        </p>
      )}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label={forced ? 'One-time password' : 'Current password'}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 8 characters, not a common password">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Save password
        </Button>
      </form>
    </div>
  );
}
