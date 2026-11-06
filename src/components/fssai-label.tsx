'use client';

import { useEffect, useState } from 'react';

const cache = new Map<number, Promise<{ label: string | null; tier: string }>>();

/** “FSSAI registered · number” or “FSSAI applied: provisional” for a kitchen, wherever a client page needs it (cart, checkout). */
export function FssaiLabel({ sellerId, className = '' }: { sellerId: number; className?: string }) {
  const [d, setD] = useState<{ label: string | null; tier: string } | null>(null);
  useEffect(() => {
    let live = true;
    if (!cache.has(sellerId)) cache.set(sellerId, fetch(`/api/fssai/badge/${sellerId}`).then((r) => r.json()).catch(() => ({ label: null, tier: 'none' })));
    cache.get(sellerId)!.then((x) => live && setD(x));
    return () => {
      live = false;
    };
  }, [sellerId]);
  if (!d?.label) return null;
  return <span className={`inline-block rounded-pill px-2.5 py-1 text-xs font-semibold ${d.tier === 'verified' ? 'bg-leaf-tint text-leaf' : 'bg-turmeric-tint text-turmeric-deep'} ${className}`} data-testid="fssai-label">{d.label}</span>;
}
