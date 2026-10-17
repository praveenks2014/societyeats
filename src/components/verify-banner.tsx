'use client';

import { useState } from 'react';

/** Shown to logged-in users whose email is not verified yet. */
export function VerifyBanner() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  async function resend() {
    setState('sending');
    await fetch('/api/auth/resend-verification', { method: 'POST' }).catch(() => {});
    setState('sent');
  }
  return (
    <div role="status" className="border-b border-turmeric/30 bg-turmeric-tint px-4 py-2 text-center text-xs text-ink-soft sm:text-sm">
      Please verify your email — we sent you a link.{' '}
      {state === 'sent' ? (
        <strong>Sent again ✓</strong>
      ) : (
        <button onClick={resend} disabled={state === 'sending'} className="min-h-[32px] font-semibold text-leaf underline">
          Resend email
        </button>
      )}
    </div>
  );
}
