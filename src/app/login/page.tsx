'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';

const roleHome: Record<string, string> = {
  buyer: '/',
  seller: '/seller',
  restaurant: '/restaurant',
  admin: '/admin',
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(data.error || 'Login failed', 'err');
      return;
    }
    router.push(params.get('next') || roleHome[data.role] || '/');
    router.refresh();
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-soft">Log in with your phone number.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Phone number">
          <Input
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10-digit mobile"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Log in
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-soft">
        New here?{' '}
        <Link href="/register" className="font-semibold text-leaf underline">
          Create an account
        </Link>
      </p>

      <Card className="mt-8 p-4 text-xs text-ink-soft">
        <div className="eyebrow mb-2">DEMO ACCOUNTS · PASSWORD: demo1234</div>
        <div className="grid grid-cols-2 gap-1.5">
          <span>🛒 Buyer</span><span className="font-mono">9999999901</span>
          <span>👩‍🍳 Seller</span><span className="font-mono">9999999902</span>
          <span>🍽️ Restaurant</span><span className="font-mono">9999999903</span>
          <span>🛠️ Admin</span><span className="font-mono">9999999904</span>
        </div>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
