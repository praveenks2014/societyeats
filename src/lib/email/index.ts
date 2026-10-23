import { eq } from 'drizzle-orm';
import { BRAND } from '@/config/brand';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { emailOutbox } from '@/lib/db/schema';
import { log } from '@/lib/log';

/**
 * EmailAdapter. Every message is recorded in `email_outbox`.
 *   mock (default, MOCK_MODE=true): the row IS the delivery — admins read it
 *        at /admin/outbox (and dev/e2e read it via /api/dev/outbox).
 *   resend (MOCK_MODE=false or EMAIL_ADAPTER=resend): sent via Resend's HTTP API.
 */
export type EmailInput = {
  userId?: number | null;
  to: string;
  subject: string;
  text: string;
  kind: string;
  /** Secret-bearing mails (verify/reset links): body is not retained once actually sent. */
  sensitive?: boolean;
};

export function emailMode(): 'mock' | 'resend' {
  const explicit = process.env.EMAIL_ADAPTER;
  if (explicit === 'mock' || explicit === 'resend') return explicit;
  return isMockMode() ? 'mock' : 'resend';
}

export async function sendEmail(m: EmailInput): Promise<number> {
  const db = await getDb();
  const mode = emailMode();
  const [row] = await db
    .insert(emailOutbox)
    .values({ userId: m.userId ?? null, toEmail: m.to.toLowerCase(), subject: m.subject, bodyText: m.text, kind: m.kind, status: mode === 'mock' ? 'mock' : 'failed' })
    .returning();
  if (mode === 'mock') return row.id;

  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY missing');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || `${BRAND.appName} <no-reply@padosiplate.example>`,
        to: [m.to],
        subject: m.subject,
        text: m.text,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(body.message || `resend ${res.status}`);
    await db
      .update(emailOutbox)
      .set({ status: 'sent', providerId: body.id ?? null, ...(m.sensitive ? { bodyText: '[secret link sent by email]' } : {}) })
      .where(eq(emailOutbox.id, row.id));
  } catch (e) {
    log.error('email.send_failed', { kind: m.kind, err: e });
    await db.update(emailOutbox).set({ status: 'failed', error: String((e as Error).message).slice(0, 300) }).where(eq(emailOutbox.id, row.id));
  }
  return row.id;
}
