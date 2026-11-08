'use client';

import { useEffect } from 'react';
import { BRAND } from '@/config/brand';

/** One anonymous count per browser session (sessionStorage guard); an invite page passes its code so the visit counts for that society. */
export function VisitPing({ code }: { code?: string }) {
  useEffect(() => {
    try {
      const key = BRAND.storageKey(`visit_${code ?? 'site'}`);
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return;
    }
    fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(code ? { code } : {}), keepalive: true }).catch(() => {});
  }, [code]);
  return null;
}
