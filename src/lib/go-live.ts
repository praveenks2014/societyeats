import { isMockMode } from '@/lib/config';
import { paymentsModeInfo } from '@/lib/payments/mode';
import { emailDeliveryFacts, type EmailFacts } from '@/lib/email/status';
import { BACKUP_STALE_HOURS, readBackupState } from '@/lib/backup/run';
import { getPlatformSettings } from '@/lib/db/platform';
import { getCronStatus } from '@/lib/cron-status';
import { listLegalDocuments } from '@/lib/legal/docs';
import { getStorage } from '@/lib/storage';
import type { PlatformSettings } from '@/lib/settings/defs';

export type GoLiveRow = {
  key: string;
  label: string;
  status: 'ok' | 'missing' | 'warn';
  /**
   * `config` rows are prerequisites read from settings and env (no network): when one is open the live guard refuses new orders.
   * `ops` rows are operational health (storage, cron, push, legal review): shown red/amber/green here and alerted on, but they NEVER stop an order.
   */
  kind: 'config' | 'ops';
  /** Blocking rows (all `config` rows) stop live mode (MOCK_MODE=false); `ops` rows never do. */
  blocking: boolean;
  /** Where / how to fix it. `setting` rows have an inline form in /admin/go-live. */
  fix: { kind: 'setting'; keys: string[] } | { kind: 'secret'; names: string[] } | { kind: 'link'; href: string; text: string } | { kind: 'info'; text: string };
  detail?: string;
};

type Env = Record<string, string | undefined>;
type Facts = { storageReachable: boolean; cronFresh: boolean; legalAllReviewed: boolean; legalCount: number; /** how payments are taken (see payments/mode.ts) */ paymentsMode?: 'mock' | 'razorpay_test' | 'razorpay_live' | 'invalid_key'; mockMode?: boolean; keyPrefix?: string | null; email?: EmailFacts; backup?: BackupFacts; now?: Date };

export type BackupFacts = { lastSuccessAt: string | null; bytes: number | null; method: string | null; lastAttemptFailed: boolean; errorShort: string | null };

/**
 * The single list of live-mode checks. The /admin/go-live page renders all of it; the live-mode guard blocks on exactly its
 * `blocking` (configuration) rows, so the two can never disagree. Pure: facts are passed in.
 */
export function buildGoLiveRows(s: PlatformSettings, env: Env, facts: Facts): GoLiveRow[] {
  const has = (v: string | undefined) => !!v?.trim();
  const row = (r: GoLiveRow) => r;
  return [
    row({ key: 'platformFssaiCentralLicenseNo', kind: 'config', label: 'Platform FSSAI Central licence number', status: has(s.platformFssaiCentralLicenseNo) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['platformFssaiCentralLicenseNo'] }, detail: 'E-commerce operators need a Central licence. 14 digits.' }),
    row({ key: 'gstPosition', kind: 'config', label: 'GST position confirmed by your CA (mode, note, date)', status: has(s.gstPositionConfirmedAt) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['gstMode', 'platformGstin', 'gstPositionConfirmedAt', 'gstPositionNote'] }, detail: `Current mode: ${s.gstMode}.` }),
    row({ key: 'legalEntity', kind: 'config', label: 'Legal entity name and registered address', status: has(s.legalEntityName) && has(s.registeredAddress) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['legalEntityName', 'registeredAddress'] } }),
    row({ key: 'grievanceOfficer', kind: 'config', label: 'Grievance officer (name, designation, email, phone)', status: has(s.grievanceOfficer) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['grievanceOfficer', 'supportEmail', 'supportPhone'] } }),
    row({ key: 'support', kind: 'config', label: 'Support email and phone', status: has(s.supportEmail) && has(s.supportPhone) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['supportEmail', 'supportPhone'] } }),
    row({ key: 'razorpayKeys', kind: 'config', label: 'Razorpay live keys (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)', status: has(env.RAZORPAY_KEY_ID) && has(env.RAZORPAY_KEY_SECRET) ? 'ok' : 'missing', blocking: true, fix: { kind: 'secret', names: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] } }),
    row({ key: 'razorpayWebhook', kind: 'config', label: 'Razorpay webhook secret (RAZORPAY_WEBHOOK_SECRET)', status: has(env.RAZORPAY_WEBHOOK_SECRET) ? 'ok' : 'missing', blocking: true, fix: { kind: 'secret', names: ['RAZORPAY_WEBHOOK_SECRET'] }, detail: 'Events: payment.authorized, payment.captured, payment.failed, refund.processed, refund.failed (+ fund_account.validation.* for RazorpayX).' }),
    row({ key: 'upiProvider', kind: 'config', label: 'UPI ownership check is not the mock provider', status: s.upiVerifyProvider !== 'mock' ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['upiVerifyProvider'] }, detail: `Current: ${s.upiVerifyProvider}.` }),
    row({ key: 'storage', kind: 'ops', label: 'File storage reachable (Replit Object Storage or S3)', status: facts.storageReachable ? 'ok' : 'missing', blocking: false, fix: { kind: 'info', text: 'Set STORAGE_ADAPTER=replit and create the Object Storage bucket; check /api/health.' } }),
    row({ key: 'cron', kind: 'ops', label: 'Scheduled jobs are running (heartbeat fresh)', status: facts.cronFresh ? 'ok' : 'missing', blocking: false, fix: { kind: 'info', text: 'Schedule POST /api/cron/run every 5 minutes with the cron secret.' } }),
    paymentsRow(facts),
    ...(facts.email ? [emailRow(facts.email)] : []),
    ...(facts.backup ? [backupRow(facts.backup, facts.now ?? new Date())] : []),
    row({ key: 'vapid', kind: 'ops', label: 'Web-push keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)', status: has(env.VAPID_PUBLIC_KEY) && has(env.VAPID_PRIVATE_KEY) ? 'ok' : 'warn', blocking: false, fix: { kind: 'secret', names: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] }, detail: 'Run npm run vapid:generate. Push is simply off without them.' }),
    row({ key: 'legalReviewed', kind: 'ops', label: 'Every legal document marked reviewed by counsel', status: facts.legalAllReviewed ? 'ok' : 'warn', blocking: false, fix: { kind: 'link', href: '/admin/legal', text: 'Open legal documents' } }),
  ];
}

/** The payments mode is an operational row: it explains what a payment would do right now, and never blocks an order by itself. */
function paymentsRow(facts: Facts): GoLiveRow {
  const mode = facts.paymentsMode ?? 'razorpay_live';
  const mockMode = facts.mockMode ?? false;
  const base = { key: 'paymentsMode', kind: 'ops' as const, label: 'Payments mode', blocking: false, fix: { kind: 'secret' as const, names: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] } };
  if (mode === 'mock') return { ...base, status: 'warn', detail: 'Mock: the fake checkout sheet is used. Add Razorpay keys (rzp_test_… or rzp_live_…) to take real payments.' };
  if (mode === 'razorpay_test') return { ...base, status: 'warn', detail: `Test mode (${facts.keyPrefix ?? 'rzp_test_'}): real Razorpay Checkout, no real money is charged.` };
  if (mode === 'invalid_key') return { ...base, status: 'missing', detail: `The Razorpay key prefix "${facts.keyPrefix ?? ''}" is not recognised. It must start with rzp_test_ or rzp_live_. Payments are refused until it is fixed.` };
  return mockMode
    ? { ...base, status: 'missing', detail: 'Live Razorpay keys need MOCK_MODE=false. Switch it once every configuration item above is done.' }
    : { ...base, status: 'ok', detail: `Live mode (${facts.keyPrefix ?? 'rzp_live_'}): real money.` };
}

/** E-mail delivery: red when mails only land in the outbox (residents get nothing), amber for a failing or test-domain Resend, green otherwise. */
function emailRow(e: EmailFacts): GoLiveRow {
  const base = { key: 'emailDelivery', kind: 'ops' as const, label: 'Email delivery', blocking: false, fix: { kind: 'secret' as const, names: ['EMAIL_ADAPTER', 'RESEND_API_KEY', 'EMAIL_FROM'] } };
  if (e.mode === 'mock') return { ...base, status: 'missing', detail: 'Emails go to /admin/outbox only, residents will not receive them. Set EMAIL_ADAPTER=resend with RESEND_API_KEY and EMAIL_FROM (a verified domain); this works even while MOCK_MODE=true.' };
  const cls = e.lastSend?.errorClass;
  if (cls === 'domain_not_verified') return { ...base, status: 'warn', detail: 'Resend refused the sender: verify the domain used in EMAIL_FROM in the Resend dashboard (Resend only delivers to arbitrary addresses from a verified domain).' };
  if (e.lastSend && !e.lastSend.ok) return { ...base, status: 'warn', detail: `The last send failed (${cls ?? 'other'}). Check RESEND_API_KEY and EMAIL_FROM.` };
  if (e.fromProblem) return { ...base, status: 'warn', detail: 'EMAIL_FROM is missing or uses resend.dev / a placeholder domain: Resend delivers only to your own address until you verify a domain and use it in EMAIL_FROM.' };
  return { ...base, status: 'ok', detail: e.lastSend ? 'Resend is on and the last send succeeded.' : 'Resend is on. No email has been sent yet.' };
}

/** Backups: amber when there is none, the last attempt failed, or the newest is older than 26 hours. */
function backupRow(b: BackupFacts, now: Date): GoLiveRow {
  const base = { key: 'backups', kind: 'ops' as const, label: 'Database backups', blocking: false, fix: { kind: 'info' as const, text: 'A backup runs daily after 03:00 IST from the cron job. Use “Run backup now” to take one immediately.' } };
  const ageH = b.lastSuccessAt ? (now.getTime() - new Date(b.lastSuccessAt).getTime()) / 3_600_000 : null;
  const last = b.lastSuccessAt ? `Last backup ${new Date(b.lastSuccessAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST, ${b.bytes != null ? `${Math.max(1, Math.round(b.bytes / 1024))} KB` : 'size unknown'}, ${b.method ?? 'unknown method'}.` : 'No backup has been taken yet.';
  if (b.lastAttemptFailed) return { ...base, status: 'warn', detail: `${last} The latest attempt failed${b.errorShort ? `: ${b.errorShort}` : ''}.` };
  if (ageH == null || ageH > BACKUP_STALE_HOURS) return { ...base, status: 'warn', detail: `${last}${ageH != null ? ` That is over ${BACKUP_STALE_HOURS} hours ago.` : ''}` };
  return { ...base, status: 'ok', detail: last };
}

export function liveBlockers(rows: GoLiveRow[]): GoLiveRow[] {
  return rows.filter((r) => r.blocking && r.status !== 'ok');
}

/** Facts that make every operational row green; the guard passes these because it must not do any I/O (ops rows never block anyway). */
const NO_IO_FACTS: Facts = { storageReachable: true, cronFresh: true, legalAllReviewed: true, legalCount: 0 };

/** The configuration prerequisites still open. Settings + env only: no storage ping, no cron read, no database call. */
export function configBlockers(s: PlatformSettings, env: Env = process.env): GoLiveRow[] {
  return liveBlockers(buildGoLiveRows(s, env, NO_IO_FACTS));
}

export async function collectGoLive(settings?: PlatformSettings, env: Env = process.env): Promise<{ rows: GoLiveRow[]; blockers: GoLiveRow[]; mockMode: boolean }> {
  const s = settings ?? (await getPlatformSettings());
  let storageReachable = false;
  try {
    await (await getStorage()).ping();
    storageReachable = true;
  } catch {
    storageReachable = false;
  }
  const cron = await getCronStatus(new Date(), Number(s.cronStaleMinutes) * 60_000).catch(() => ({ stale: true }));
  const docs = await listLegalDocuments().catch(() => []);
  const pm = paymentsModeInfo(env);
  const bk = await readBackupState().catch(() => null);
  const rows = buildGoLiveRows(s, env, { email: await emailDeliveryFacts(env).catch(() => undefined), backup: bk ? { lastSuccessAt: bk.lastSuccessAt, bytes: bk.bytes, method: bk.method, lastAttemptFailed: !bk.ok, errorShort: bk.error } : undefined, now: new Date(), paymentsMode: pm.mode ?? 'invalid_key', keyPrefix: pm.prefix, mockMode: isMockMode(), storageReachable, cronFresh: !cron.stale, legalCount: docs.length, legalAllReviewed: docs.length > 0 && docs.every((d) => d.reviewStatus === 'reviewed') });
  return { rows, blockers: liveBlockers(rows), mockMode: isMockMode() };
}
