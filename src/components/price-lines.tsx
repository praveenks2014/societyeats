'use client';

import { useEffect, useState } from 'react';
import { formatINR } from '@/lib/money';
import type { FeeConfig } from '@/lib/money';
import { priceBreakdown } from '@/lib/money/price-breakdown';

let cached: FeeConfig | null = null;
let inflight: Promise<FeeConfig | null> | null = null;

export function useFeeConfig(): FeeConfig | null {
  const [cfg, setCfg] = useState<FeeConfig | null>(cached);
  useEffect(() => {
    if (cached) return;
    inflight ??= fetch('/api/fee-config')
      .then((r) => r.json())
      .then((d) => (cached = d.feeConfig as FeeConfig))
      .catch(() => null);
    let live = true;
    inflight.then((c) => live && c && setCfg(c));
    return () => {
      live = false;
    };
  }, []);
  return cfg;
}

/** One-line upfront price: “₹X food (pay the kitchen at your door) + ₹Y platform fee (pay now)”. */
export function PriceSummary({ foodPaise, className = '' }: { foodPaise: number; className?: string }) {
  const cfg = useFeeConfig();
  if (!cfg) return null;
  return (
    <div className={`text-xs text-ink-soft ${className}`} data-testid="price-summary">
      {priceBreakdown(foodPaise, cfg).summary}
    </div>
  );
}

/** Itemised version for the dish page and cart. */
export function PriceLines({ foodPaise }: { foodPaise: number }) {
  const cfg = useFeeConfig();
  if (!cfg) return null;
  const b = priceBreakdown(foodPaise, cfg);
  return (
    <div className="rounded-card border border-rice-line bg-white p-3 text-sm" data-testid="price-lines">
      {b.lines.map((l) => (
        <div key={l.key} className="flex justify-between gap-3 py-0.5">
          <span className="text-ink-soft">{l.label}</span>
          <span className="font-semibold">{l.amountPaise < 0 ? `−${formatINR(-l.amountPaise)}` : formatINR(l.amountPaise)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-rice-line pt-1 text-xs text-ink-faint">
        <span>Pay now</span>
        <span>{formatINR(b.payNowPaise)}</span>
      </div>
    </div>
  );
}
