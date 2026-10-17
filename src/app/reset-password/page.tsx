'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not reset password', 'err');
      return;
    }
    toast('Password updated — please log in');
    router.push('/login');
  }

  if (!token) {
    return (
      <p className="mt-10 text-center text-sm">
        This link is missing its token. <Link href="/forgot-password" className="font-semibold text-leaf underline">Request a new one</Link>.
      </p>
    );
  }
  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="New password" hint="At least 8 characters, not a common password">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
