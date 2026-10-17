'use client';

import { useEffect, useState } from 'react';
import { Card, Skeleton } from '@/components/ui';

type Funnel = { stages: { key: string; label: string }[]; total: Record<string, number>; societies: { name: string; counts: Record<string, number> }[] };

/** Started → eligible → details complete → documents ready → pack downloaded → reference entered → verified, per society. */
export function FssaiFunnel() {
  const [f, setF] = useState<Funnel | null>(null);
  useEffect(() => {
    fetch('/api/admin/fssai/funnel').then((r) => r.json()).then(setF).catch(() => {});
  }, []);
  if (!f) return <Skeleton className="mt-5 h-32 w-full" />;
  const max = Math.max(1, ...f.stages.map((s) => f.total[s.key] ?? 0));
  return (
    <Card className="mt-5 p-4" data-testid="fssai-funnel">
      <div className="eyebrow">FSSAI ASSISTANT FUNNEL</div>
      <div className="mt-3 space-y-1.5">
        {f.stages.map((s) => (
          <div key={s.key} className="flex items-center gap-3 text-sm">
            <span className="w-36 shrink-0 text-ink-soft">{s.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-pill bg-rice-deep"><div className="h-full bg-leaf" style={{ width: `${((f.total[s.key] ?? 0) / max) * 100}%` }} /></div>
            <span className="w-8 text-right font-semibold">{f.total[s.key] ?? 0}</span>
          </div>
        ))}
      </div>
      {f.societies.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead><tr className="border-b border-rice-line text-left text-ink-faint"><th className="py-1">Society</th>{f.stages.map((s) => <th key={s.key} className="py-1 text-right">{s.label}</th>)}</tr></thead>
            <tbody>
              {f.societies.map((r) => (
                <tr key={r.name} className="border-b border-rice-line last:border-0"><td className="py-1.5 font-medium">{r.name}</td>{f.stages.map((s) => <td key={s.key} className="py-1.5 text-right">{r.counts[s.key] ?? 0}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
