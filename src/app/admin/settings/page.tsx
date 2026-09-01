'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type Settings = {
  commissionHomePct: number;
  commissionMallPct: number;
  platformFeePaise: number;
  fssaiPendingMaxDays: number;
  radiusKm: number;
  platformDeliveryEnabled: boolean;
  platformDeliveryFeeInPaise: number;
  platformDeliveryMinOrderPaise: number;
};

const FIELDS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'commissionHomePct', label: 'Home-cook commission (%)', hint: 'Deducted from seller payouts. Default 12.' },
  { key: 'commissionMallPct', label: 'Mall restaurant commission (%)', hint: 'No delivery cost — default 6.' },
  { key: 'platformFeePaise', label: 'Buyer platform fee (paise)', hint: '0 = free at launch. 500 = ₹5/order.' },
  { key: 'fssaiPendingMaxDays', label: 'FSSAI-pending grace window (days)', hint: 'Listings auto-pause after this.' },
  { key: 'radiusKm', label: 'Delivery radius (km)', hint: 'The hyperlocal boundary. Default 10.' },
];

const PLATFORM_DELIVERY_FIELDS: { key: keyof Settings; label: string; hint: string }[] = [
  {
    key: 'platformDeliveryFeeInPaise',
    label: 'Platform delivery fallback fee (paise)',
    hint: 'Used only if no live/mock provider quote is available. Passed through to the buyer at cost.',
  },
  {
    key: 'platformDeliveryMinOrderPaise',
    label: 'Minimum order for platform delivery (paise)',
    hint: '25000 = ₹250 (founder default). Below this, only self-pickup / seller delivery show.',
  },
];

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mockMode, setMockMode] = useState(true);
  const [form, setForm] = useState<Record<string, string>>({});
  const [platformDeliveryEnabled, setPlatformDeliveryEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        setSettings(d.settings);
        setMockMode(d.mockMode);
        setPlatformDeliveryEnabled(!!d.settings.platformDeliveryEnabled);
        setForm(
          Object.fromEntries(
            Object.entries(d.settings)
              .filter(([k]) => k !== 'platformDeliveryEnabled')
              .map(([k, v]) => [k, String(v)]),
          ),
        );
      })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    const body: Record<string, number | boolean> = { platformDeliveryEnabled };
    for (const f of [...FIELDS, ...PLATFORM_DELIVERY_FIELDS]) body[f.key] = Number(form[f.key]);
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not save', 'err');
      return;
    }
    setSettings(d.settings);
    setPlatformDeliveryEnabled(!!d.settings.platformDeliveryEnabled);
    toast('Settings live ✅ — applies to the next order');
  }

  if (!settings) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">Platform settings</h1>
      <Card className="mt-4 flex items-center justify-between p-4">
        <div>
          <div className="text-sm font-semibold">Integrations mode</div>
          <div className="text-xs text-ink-faint">Set via MOCK_MODE env var (restart to change)</div>
        </div>
        {mockMode ? <Badge tone="amber">MOCK_MODE</Badge> : <Badge tone="green">LIVE</Badge>}
      </Card>

      <div className="mt-5 space-y-4">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <Input
              inputMode="numeric"
              value={form[f.key] ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
            />
          </Field>
        ))}

        <Card className="p-4">
          <div className="eyebrow mb-2">FULFILLMENT — PLATFORM DELIVERY (OVERFLOW)</div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={platformDeliveryEnabled}
              onChange={(e) => setPlatformDeliveryEnabled(e.target.checked)}
              className="h-4 w-4 accent-leaf"
            />
            Enable platform-facilitated delivery (Porter / Shadowfax / Borzo)
          </label>
          <p className="mt-1 text-xs text-ink-faint">
            Self-pickup and seller-delivery are always the primary options. This turns on the
            third-party orchestrator as a buyer-selectable overflow option, feature-flagged off by
            default per the fulfillment pivot.
          </p>
        </Card>

        {PLATFORM_DELIVERY_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <Input
              inputMode="numeric"
              value={form[f.key] ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
            />
          </Field>
        ))}

        <Button size="lg" className="w-full" loading={busy} onClick={save}>
          Save — applies immediately
        </Button>
      </div>
    </div>
  );
}
