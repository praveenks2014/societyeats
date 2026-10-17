'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';

export default function ForgotPasswordPage() {
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || 'Something went wrong', 'err');
      return;
    }
    setSent(true);
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">Forgot your password?</h1>
      {sent ? (
        <div className="mt-4 rounded-2xl bg-leaf-tint p-4 text-sm text-leaf" role="status">
          If an account exists for that email or phone, we&apos;ve sent a reset link. It works once and expires in 30 minutes.
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <p className="text-sm text-ink-soft">Enter your email or phone number and we&apos;ll email you a reset link.</p>
          <Field label="Email or phone number">
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link href="/login" className="font-semibold text-leaf underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
