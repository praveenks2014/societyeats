'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';

const roleHome: Record<string, string> = {
  buyer: '/',
  seller: '/seller',
  restaurant: '/restaurant',
  admin: '/admin',
};

export function LoginForm({ showDemo }: { showDemo: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(data.error || 'Login failed', 'err');
      return;
    }
    if (data.mustChangePassword) {
      router.push('/change-password');
      router.refresh();
      return;
    }
    router.push(params.get('next') || roleHome[data.role] || '/');
    router.refresh();
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-soft">Log in with your email or phone number.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email or phone number">
          <Input
            autoComplete="username"
            placeholder="you@example.com or 10-digit mobile"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
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
      <p className="mt-3 text-sm">
        <Link href="/forgot-password" className="font-semibold text-leaf underline">
          Forgot password?
        </Link>
      </p>
      <p className="mt-4 text-sm text-ink-soft">
        New here?{' '}
        <Link href="/register" className="font-semibold text-leaf underline">
          Create an account
        </Link>
      </p>

      {showDemo && (
        <Card className="mt-8 p-4 text-xs text-ink-soft">
          <div className="eyebrow mb-2">LOCAL DEMO ACCOUNTS · PASSWORD: demo1234</div>
          <div className="grid grid-cols-2 gap-1.5">
            <span>🛒 Buyer</span><span className="font-mono">9999999901</span>
            <span>👩‍🍳 Seller</span><span className="font-mono">9999999902</span>
            <span>🍽️ Restaurant</span><span className="font-mono">9999999903</span>
            <span>🛠️ Admin</span><span className="font-mono">admin@demo.padosiplate.example</span>
          </div>
        </Card>
      )}
    </div>
  );
}
