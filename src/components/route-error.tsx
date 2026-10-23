'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Shared body for every route group's error.tsx — friendly, no stack traces. */
export function RouteError({ error, reset, area }: { error: Error & { digest?: string }; reset: () => void; area: string }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: 'error', event: 'ui.error', area, digest: error.digest }));
  }, [error, area]);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-card border border-rice-line bg-white p-6 text-center shadow-card">
      <div className="text-3xl" aria-hidden>🍲</div>
      <h2 className="mt-2 text-lg font-bold">Something went wrong</h2>
      <p className="mt-1 text-sm text-ink-soft">That page hit a snag. You can try again, or head back home.</p>
      <div className="mt-4 flex justify-center gap-3">
        <button onClick={reset} className="min-h-[44px] rounded-pill bg-leaf px-5 text-sm font-semibold text-white">Try again</button>
        <Link href="/" className="inline-flex min-h-[44px] items-center rounded-pill border border-rice-line px-5 text-sm font-semibold text-ink">Home</Link>
      </div>
      {error.digest && <p className="mt-3 text-[11px] text-ink-faint">Ref: {error.digest}</p>}
    </div>
  );
}
