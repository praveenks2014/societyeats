'use client';

import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { useToast } from '@/components/providers';

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Asks to turn on order alerts. Shown only on an order page (so after the person's first order, never on a first visit),
 * only when push is available on the server and in this browser, and never again once dismissed.
 */
export function PushOptIn() {
  const toast = useToast();
  const [state, setState] = useState<'hidden' | 'ask' | 'busy'>('hidden');
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
        if (Notification.permission !== 'default' || localStorage.getItem('padosi_push_dismissed') === '1') return;
        const cfg = await fetch('/api/push/config').then((r) => r.json());
        if (live && cfg.enabled && cfg.publicKey) {
          setKey(cfg.publicKey);
          setState('ask');
        }
      } catch {
        /* no push: stay hidden */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state === 'hidden' || !key) return null;

  async function enable() {
    setState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        localStorage.setItem('padosi_push_dismissed', '1');
        return setState('hidden');
      }
      const reg = await navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key!) });
      const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error('save failed');
      toast('Order alerts are on ✅');
      setState('hidden');
    } catch {
      toast('Could not turn on alerts on this device', 'err');
      setState('ask');
    }
  }

  return (
    <Card className="mt-4 flex items-center justify-between gap-3 p-4" data-testid="push-optin">
      <div className="text-sm">
        <div className="font-semibold">Get order alerts on this phone?</div>
        <div className="text-xs text-ink-faint">We will tell you when the kitchen accepts, is on the way or at your door. Turn it off any time in Account.</div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button size="sm" loading={state === 'busy'} onClick={enable} data-testid="push-enable">Turn on</Button>
        <button className="min-h-[44px] text-xs text-ink-faint underline" onClick={() => { localStorage.setItem('padosi_push_dismissed', '1'); setState('hidden'); }}>Not now</button>
      </div>
    </Card>
  );
}
