import { desc, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { emailOutbox } from '@/lib/db/schema';
import { emailMode } from '@/lib/email';

/**
 * What /admin/go-live shows about e-mail delivery. Mode comes from `emailMode()` (EMAIL_ADAPTER=resend wins over MOCK_MODE=true), the last
 * outcome from the newest real send in `email_outbox`. Only an error CLASS is ever shown, never the provider's message or an address.
 */
export type EmailErrorClass = 'domain_not_verified' | 'api_key' | 'rate_limited' | 'network' | 'other';
export type EmailFacts = { mode: 'mock' | 'resend'; lastSend: { ok: boolean; errorClass: EmailErrorClass | null } | null; fromProblem: 'test_domain' | null };

export function classifyEmailError(message: string | null | undefined): EmailErrorClass {
  const m = (message ?? '').toLowerCase();
  if (/domain|testing emails|not verified|verify a domain|from address/.test(m)) return 'domain_not_verified';
  if (/api key|resend_api_key|unauthori[sz]ed|forbidden|restricted|\b40[13]\b/.test(m)) return 'api_key';
  if (/rate limit|too many|\b429\b/.test(m)) return 'rate_limited';
  if (/fetch failed|network|econn|timeout|enotfound/.test(m)) return 'network';
  return 'other';
}

/** `onboarding@resend.dev` and placeholder domains only deliver to the account owner: the sending domain must be verified in Resend. */
export function fromDomainProblem(emailFrom: string | undefined): 'test_domain' | null {
  const host = emailFrom?.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
  if (!host) return 'test_domain'; // the built-in fallback address is a placeholder
  return host.endsWith('resend.dev') || host.endsWith('.example') || host === 'example.com' ? 'test_domain' : null;
}

export async function emailDeliveryFacts(env: Record<string, string | undefined> = process.env): Promise<EmailFacts> {
  const mode = emailMode();
  if (mode === 'mock') return { mode, lastSend: null, fromProblem: null };
  const db = await getDb();
  const [last] = await db.select({ status: emailOutbox.status, error: emailOutbox.error }).from(emailOutbox).where(inArray(emailOutbox.status, ['sent', 'failed'])).orderBy(desc(emailOutbox.id)).limit(1);
  return {
    mode,
    lastSend: last ? { ok: last.status === 'sent', errorClass: last.status === 'sent' ? null : classifyEmailError(last.error) } : null,
    fromProblem: fromDomainProblem(env.EMAIL_FROM),
  };
}
