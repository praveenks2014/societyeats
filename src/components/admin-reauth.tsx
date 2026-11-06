'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input, Modal } from '@/components/ui';

/**
 * Sensitive admin actions (settings, refunds, delisting, reading a reported chat, exports) answer 403 `reauth_required`
 * unless the authenticator was confirmed in the last 10 minutes. This wraps fetch for /api/admin calls: it asks for the
 * code in a dialog, re-confirms, then retries the original request once — so no page needs to know about it.
 */
export function AdminReauth() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<null | ((ok: boolean) => void)>(null);

  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const res = await original(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (res.status !== 403 || !url.includes('/api/admin')) return res;
      const body = await res.clone().json().catch(() => ({}));
      if (body.code !== 'reauth_required') return res;
      const ok = await new Promise<boolean>((resolve) => {
        pending.current = resolve;
        setCode('');
        setError('');
        setOpen(true);
      });
      return ok ? original(input, init) : res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  async function confirm() {
    setBusy(true);
    const res = await fetch('/api/auth/2fa/reauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    setBusy(false);
    if (!res.ok) return setError('That code is wrong');
    setOpen(false);
    pending.current?.(true);
  }

  function cancel() {
    setOpen(false);
    pending.current?.(false);
  }

  return (
    <Modal open={open} onClose={cancel} title="Confirm it's you" sheet>
      <p className="text-sm text-ink-soft">This action needs a fresh two-factor code.</p>
      <div className="mt-3 space-y-3">
        <Field label="Authenticator code or recovery code"><Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" data-testid="reauth-code" /></Field>
        {error && <p className="text-sm text-chili" role="alert">{error}</p>}
        <Button className="w-full" loading={busy} disabled={!code.trim()} onClick={confirm} data-testid="reauth-confirm">Confirm</Button>
      </div>
    </Modal>
  );
}
