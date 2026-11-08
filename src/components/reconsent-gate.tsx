'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { useToast } from '@/components/providers';
import { BRAND } from '@/config/brand';

type Pending = { slug: string; title: string; version: number; changeSummary: string | null };

/** Blocking modal shown after an admin publishes a material change to Terms / Privacy / Kitchen Terms. */
export function ReconsentGate({ pending }: { pending: Pending[] }) {
  const toast = useToast();
  const [left, setLeft] = useState(pending);
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!left.length) return null;
  async function accept() {
    setBusy(true);
    const res = await fetch('/api/consent/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slugs: ticked }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not save', 'err');
    setLeft(d.pending ?? []);
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="reconsent-title" data-testid="reconsent-modal">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <h2 id="reconsent-title" className="text-lg font-bold">We updated our terms</h2>
        <p className="mt-1 text-sm text-ink-soft">Please read what changed and accept to keep using {BRAND.name}.</p>
        <ul className="mt-4 space-y-3">
          {left.map((p) => (
            <li key={p.slug} className="rounded-xl bg-rice-deep p-3 text-sm">
              <div className="font-semibold">{p.title} <span className="text-xs font-normal text-ink-faint">· version {p.version}</span></div>
              {p.changeSummary && <p className="mt-1 text-ink-soft" data-testid="change-summary">What changed: {p.changeSummary}</p>}
              <Link href={`/legal/${p.slug}`} target="_blank" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-leaf underline">Read the full text</Link>
              <label className="flex min-h-[44px] items-center gap-3">
                <input type="checkbox" className="h-5 w-5 accent-leaf" checked={ticked.includes(p.slug)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, p.slug] : t.filter((x) => x !== p.slug)))} data-testid={`accept-${p.slug}`} />
                I accept the updated {p.title}
              </label>
            </li>
          ))}
        </ul>
        <Button size="lg" className="mt-4 w-full" loading={busy} disabled={!left.every((p) => ticked.includes(p.slug))} onClick={accept} data-testid="reconsent-accept">Accept and continue</Button>
      </div>
    </div>
  );
}
