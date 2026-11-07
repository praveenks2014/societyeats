'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const sent = useRef('');

  useEffect(() => {
    // single-use token: React dev StrictMode runs effects twice, and a second POST would report the link as already used
    if (token && sent.current === token) return;
    sent.current = token;
    if (!token) {
      setState('error');
      setMessage('This link is missing its token.');
      return;
    }
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setState('ok');
        else {
          setState('error');
          setMessage(d.error || 'Verification failed');
        }
      })
      .catch(() => {
        setState('error');
        setMessage('Network error — try again.');
      });
  }, [token]);

  return (
    <div className="mx-auto mt-16 max-w-sm text-center" role="status">
      {state === 'working' && <p className="text-sm text-ink-soft">Verifying your email…</p>}
      {state === 'ok' && (
        <>
          <div className="text-3xl" aria-hidden>✅</div>
          <h1 className="mt-2 text-xl font-bold" data-testid="email-verified">Email verified</h1>
          <p className="mt-1 text-sm text-ink-soft">Thanks — your address is confirmed.</p>
          <Link href="/" className="mt-4 inline-flex min-h-[44px] items-center rounded-pill bg-leaf px-6 text-sm font-semibold text-white">Continue</Link>
        </>
      )}
      {state === 'error' && (
        <>
          <div className="text-3xl" aria-hidden>⚠️</div>
          <h1 className="mt-2 text-xl font-bold">Link problem</h1>
          <p className="mt-1 text-sm text-ink-soft">{message} Log in and request a new verification email from the banner.</p>
          <Link href="/login" className="mt-4 inline-flex min-h-[44px] items-center rounded-pill bg-leaf px-6 text-sm font-semibold text-white">Log in</Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
