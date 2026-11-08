'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers';
import { BRAND } from '@/config/brand';

const roleHome: Record<string, string> = {
  buyer: '/',
  seller: '/seller',
  restaurant: '/restaurant',
  admin: '/admin',
};

const ERRORS: Record<string, string> = {
  google_off: 'Google sign-in is not set up yet.',
  google_failed: 'Google sign-in did not work. Please try again.',
  google_unverified: 'Your Google email is not verified.',
  google_link_first: 'An account with this email already exists. Log in with your password (or an emailed code) first, then link Google from your Account page.',
  google_no_account: `No ${BRAND.name} account is linked to that Google account. Sign up with your invite link first.`,
};

export function LoginForm({ showDemo, google }: { showDemo: boolean; google: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // "Email me a code" sign-in
  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const err = params.get('error');

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/login-code/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identifier }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(data.error || 'Could not send the code', 'err');
    setCodeSent(true);
    toast(data.message || 'Code sent');
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/login-code/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identifier, code }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(data.error || 'That code did not work', 'err');
    if (data.mustChangePassword) router.push('/change-password');
    else if (data.mfa) router.push(`/auth/2fa?next=${encodeURIComponent(params.get('next') || '/admin')}`);
    else router.push(params.get('next') || roleHome[data.role] || '/');
    router.refresh();
  }

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
    if (data.mfa) {
      router.push(`/auth/2fa?next=${encodeURIComponent(params.get('next') || '/admin')}`);
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
      {err && <p className="mt-3 rounded-xl bg-chili-tint px-3 py-2 text-sm text-chili-dark" role="alert">{ERRORS[err] ?? 'Sign-in did not work. Please try again.'}</p>}
      {mode === 'code' ? (
        <form onSubmit={codeSent ? verifyCode : sendCode} className="mt-6 space-y-4" data-testid="code-form">
          <Field label="Email"><Input type="email" autoComplete="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></Field>
          {codeSent && <Field label="6-digit code" hint="Sent to your email. Works once, for 10 minutes."><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-testid="login-code" required /></Field>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>{codeSent ? 'Log in' : 'Email me a code'}</Button>
          <button type="button" className="min-h-[44px] w-full text-sm font-semibold text-leaf underline" onClick={() => { setMode('password'); setCodeSent(false); }}>Use my password instead</button>
        </form>
      ) : (
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
      )}
      {mode === 'password' && (
        <div className="mt-3 space-y-2">
          <button type="button" className="min-h-[44px] w-full rounded-xl border border-rice-line text-sm font-semibold" onClick={() => setMode('code')} data-testid="use-code">Email me a 6-digit code instead</button>
          {google && <a href="/api/auth/google/start" className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-rice-line text-sm font-semibold" data-testid="google-signin">Continue with Google</a>}
        </div>
      )}
      <p className="mt-3 text-sm">
        <Link href="/forgot-password" className="inline-flex min-h-[44px] items-center font-semibold text-leaf underline">
          Forgot password?
        </Link>
      </p>
      <p className="mt-4 text-sm text-ink-soft">
        New here?{' '}
        <Link href="/register" className="inline-flex min-h-[44px] items-center font-semibold text-leaf underline">
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
            <span>🛠️ Admin</span><span className="break-all font-mono">admin@demo.{BRAND.slug}.example</span>
          </div>
        </Card>
      )}
    </div>
  );
}
