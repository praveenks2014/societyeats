'use client';

import { useEffect, useState } from 'react';
import { Card, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type Prefs = { pushEnabled: boolean; whatsappEnabled: boolean; smsEnabled: boolean; marketingEnabled: boolean };
const ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'pushEnabled', label: 'Phone alerts (push)', hint: 'Order updates on this device, even when the app is closed. Quiet between 10 pm and 7 am except for urgent ones like “at your door”.' },
  { key: 'whatsappEnabled', label: 'WhatsApp messages', hint: 'Order updates on WhatsApp. (Not live yet in the pilot.)' },
  { key: 'smsEnabled', label: 'SMS', hint: 'Order updates by text. (Not live yet in the pilot.)' },
  { key: 'marketingEnabled', label: 'Offers and news', hint: 'Occasional offers from PadosiPlate. Off unless you turn it on.' },
];

export function NotificationPrefsForm() {
  const toast = useToast();
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => {
    fetch('/api/account/notification-prefs').then((r) => r.json()).then((d) => setP(d.prefs));
  }, []);
  async function toggle(key: keyof Prefs, value: boolean) {
    setP((cur) => (cur ? { ...cur, [key]: value } : cur));
    const res = await fetch('/api/account/notification-prefs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) });
    if (!res.ok) {
      toast('Could not save', 'err');
      setP((cur) => (cur ? { ...cur, [key]: !value } : cur));
    }
  }
  if (!p) return <Skeleton className="mx-auto mt-8 h-64 w-full max-w-lg" />;
  return (
    <div className="mx-auto max-w-lg space-y-4 pt-8">
      <h1 className="text-2xl font-bold">Notifications</h1>
      <p className="text-sm text-ink-soft">Messages about your orders and account always arrive in the app and by email. These switches are for the extras.</p>
      {ROWS.map((r) => (
        <Card key={r.key} className="p-4">
          <label className="flex min-h-[44px] items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-leaf" checked={p[r.key]} onChange={(e) => toggle(r.key, e.target.checked)} data-testid={`pref-${r.key}`} />
            <span>
              <span className="block font-semibold">{r.label}</span>
              <span className="block text-xs text-ink-faint">{r.hint}</span>
            </span>
          </label>
        </Card>
      ))}
    </div>
  );
}
