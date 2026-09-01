'use client';

import { useEffect, useState } from 'react';

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). A wa.me deep link with prefilled share text — the whole "WhatsApp
 * share" requirement in one reusable component (listing pages, kitchen
 * pages, the referral page). The current page's own URL is read from
 * `window.location` after mount rather than passed as a prop from the
 * server: it's the simplest way to get an accurate, always-current URL
 * without threading a request-derived origin (src/lib/site-url.ts) through
 * every client component that wants to share itself.
 */
export function ShareButton({
  text,
  url,
  className = '',
}: {
  text: string;
  /** Defaults to the current page's own URL when omitted (e.g. a referral link instead). */
  url?: string;
  className?: string;
}) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    setHref(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url ?? window.location.href}`)}`);
  }, [text, url]);

  return (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!href) e.preventDefault();
      }}
      aria-disabled={!href}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] px-3.5 py-2 text-sm font-semibold text-white shadow-card transition-transform active:scale-[0.98] ${className}`}
    >
      <WhatsAppMark /> Share on WhatsApp
    </a>
  );
}

function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden>
      <path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.2-.1-.4-.1-.6.1-.2.3-.7.9-.8 1-.2.2-.3.2-.5.1-.3-.1-1.2-.4-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.5.1-.6l.4-.5c.1-.1.2-.2.2-.4.1-.1 0-.3 0-.4-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.1 0 1.3 1 2.5 1.1 2.7.1.2 2 3 4.8 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.6-.7 1.9-1.3.2-.6.2-1.1.2-1.3-.1-.1-.3-.2-.6-.3z" />
      <path d="M12 2a10 10 0 0 0-8.6 15l-1.1 4 4.2-1.1A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 20.2 12 8.2 8.2 0 0 1 12 20.2z" />
    </svg>
  );
}
