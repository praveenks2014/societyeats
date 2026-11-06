'use client';

import { useEffect, useState } from 'react';
import { DisclaimerClient } from '@/components/disclaimer-client';

/** The thin “pilot” banner. Dismissible per disclaimer version, so an edited text shows again. */
export function PilotBanner({ version }: { version: number }) {
  const key = `padosi_pilot_banner_v${version}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === '1');
    } catch {
      setHidden(false);
    }
  }, [key]);
  if (hidden) return null;
  return (
    <div className="mx-auto flex max-w-5xl items-start gap-2 px-4 pt-2 sm:px-6" data-testid="pilot-banner">
      <div className="flex-1">
        <DisclaimerClient id="pilot" />
      </div>
      <button
        aria-label="Dismiss pilot notice"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-faint"
        onClick={() => {
          try {
            localStorage.setItem(key, '1');
          } catch {
            /* private mode */
          }
          setHidden(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
