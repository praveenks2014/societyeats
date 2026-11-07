'use client';

import { useEffect, useState } from 'react';
import { Badge, Card } from '@/components/ui';

type Q = { orders: number; topKitchen: boolean; checks: { key: string; label: string; ok: boolean; value: string; need: string }[] };

/** The kitchen's own numbers: what it needs for the public Top Kitchen badge. Only the badge is public. */
export function QualityCard() {
  const [q, setQ] = useState<Q | null>(null);
  useEffect(() => {
    fetch('/api/seller/quality').then((r) => (r.ok ? r.json() : null)).then(setQ).catch(() => {});
  }, []);
  if (!q) return null;
  return (
    <Card className="mt-5 p-4" data-testid="quality-card">
      <div className="flex items-center justify-between">
        <div className="eyebrow">YOUR QUALITY · LAST 30 DAYS</div>
        {q.topKitchen ? <Badge tone="green">🏆 Top Kitchen</Badge> : <Badge tone="neutral">Not yet</Badge>}
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {q.checks.map((c) => (
          <li key={c.key} className="flex justify-between gap-2" data-check={c.key} data-ok={c.ok}>
            <span>{c.ok ? '✅' : '⬜'} {c.label}</span>
            <span className="text-ink-soft">{c.value} <span className="text-xs text-ink-faint">(need {c.need})</span></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
