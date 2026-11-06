'use client';

import { useEffect, useState } from 'react';
import { DisclaimerText } from '@/components/disclaimer';
import { DISCLAIMER_DEFAULTS, type DisclaimerId } from '@/lib/disclaimers/defs';
import { fillDisclaimer } from '@/lib/disclaimers/fill';

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

function load(): Promise<Record<string, string>> {
  inflight ??= fetch('/api/disclaimers')
    .then((r) => r.json())
    .then((d) => (cache = d.disclaimers as Record<string, string>))
    .catch(() => ({}));
  return inflight;
}

/** Same disclaimer as the server component, for client components. Renders the built-in default instantly, then the admin-edited text. */
export function DisclaimerClient({ id, vars, className }: { id: DisclaimerId; vars?: Record<string, string | number>; className?: string }) {
  const [text, setText] = useState<string>(cache?.[id] ?? DISCLAIMER_DEFAULTS[id]);
  useEffect(() => {
    let live = true;
    load().then((m) => live && m[id] && setText(m[id]));
    return () => {
      live = false;
    };
  }, [id]);
  return <DisclaimerText id={id} text={fillDisclaimer(text, vars)} className={className} />;
}
