'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type ProviderRow = {
  provider: 'porter' | 'shadowfax' | 'borzo';
  isEnabled: boolean;
  priority: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  chaosForceFail: boolean;
};

const LOGOS: Record<string, string> = { porter: '🚚', shadowfax: '🦊', borzo: '🛵' };

export default function AdminProviders() {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/admin/providers')
      .then((r) => r.json())
      .then((d) => setRows(d.providers))
      .catch(() => {});
  }
  useEffect(load, []);

  async function patch(provider: string, body: Record<string, unknown>, msg: string) {
    const res = await fetch('/api/admin/providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, ...body }),
    });
    if (!res.ok) {
      toast('Could not update', 'err');
      return;
    }
    toast(msg);
    load();
  }

  if (!rows) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Delivery providers</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Dispatch walks this priority list top-to-bottom with 8-second timeouts. A provider that
        fails 5 times in a row is auto-disabled.
      </p>

      <Card className="mt-4 border-turmeric bg-turmeric-tint/50 p-4 text-sm">
        🧨 <strong>Chaos toggle:</strong> force a provider down and place a demo order — watch the
        orchestrator fail over live in the order&apos;s dispatch log. (30-second demo script in the
        README.)
      </Card>

      <div className="mt-5 space-y-3">
        {rows.map((p) => (
          <Card key={p.provider} className={`p-4 ${!p.isEnabled ? 'opacity-70' : ''}`}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl">{LOGOS[p.provider]}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold capitalize">
                  {p.provider}{' '}
                  <span className="text-xs font-normal text-ink-faint">priority {p.priority}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {p.isEnabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="red">Disabled</Badge>}
                  {p.chaosForceFail && <Badge tone="red">🧨 Chaos: forced down</Badge>}
                  {p.failureCount > 0 && <Badge tone="amber">{p.failureCount} consecutive failures</Badge>}
                </div>
                <div className="mt-1 text-[11px] text-ink-faint">
                  Last success: {p.lastSuccessAt ? new Date(p.lastSuccessAt).toLocaleTimeString('en-IN') : '—'} ·
                  Last failure: {p.lastFailureAt ? new Date(p.lastFailureAt).toLocaleTimeString('en-IN') : '—'}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant={p.chaosForceFail ? 'danger' : 'secondary'}
                  onClick={() =>
                    patch(
                      p.provider,
                      { chaosForceFail: !p.chaosForceFail },
                      p.chaosForceFail ? `${p.provider} restored 🎉` : `${p.provider} forced down 🧨`,
                    )
                  }
                >
                  {p.chaosForceFail ? 'End chaos' : '🧨 Force down'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    patch(
                      p.provider,
                      { isEnabled: !p.isEnabled, resetFailures: !p.isEnabled },
                      p.isEnabled ? 'Provider disabled' : 'Provider re-enabled',
                    )
                  }
                >
                  {p.isEnabled ? 'Disable' : 'Re-enable'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
