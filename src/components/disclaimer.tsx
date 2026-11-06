import Link from 'next/link';
import { getDisclaimerText } from '@/lib/disclaimers';
import { fillDisclaimer } from '@/lib/disclaimers/fill';
import { renderInline } from '@/components/disclaimer-text';
import type { DisclaimerId } from '@/lib/disclaimers/defs';

/**
 * Server component: renders one of the 18 disclaimers from the database (admin-editable, versioned).
 * Always visible text — never a tooltip or hover-only.
 */
export async function Disclaimer({ id, vars, learnMoreHref, className = '' }: { id: DisclaimerId; vars?: Record<string, string | number>; learnMoreHref?: string; className?: string }) {
  const text = fillDisclaimer(await getDisclaimerText(id), vars);
  return (
    <p className={`rounded-xl bg-rice-deep px-3 py-2 text-xs leading-relaxed text-ink-soft ${className}`} data-disclaimer={id} role="note">
      {renderInline(text)}
      {learnMoreHref && (
        <>
          {' '}
          <Link href={learnMoreHref} className="inline-flex min-h-[44px] items-center font-semibold text-leaf underline">
            Learn more
          </Link>
        </>
      )}
    </p>
  );
}
