import type { DisclaimerId } from '@/lib/disclaimers/defs';

/** **bold** only; everything else is plain text (React escapes it). Client-safe: no database imports here. */
export function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

/** The visual box for a disclaimer's text; used by both the server and the client wrappers. */
export function DisclaimerText({ text, id, className = '' }: { text: string; id: DisclaimerId; className?: string }) {
  return (
    <p className={`rounded-xl bg-rice-deep px-3 py-2 text-xs leading-relaxed text-ink-soft ${className}`} data-disclaimer={id} role="note">
      {renderInline(text)}
    </p>
  );
}
