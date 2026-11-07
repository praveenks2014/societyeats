import { isMockMode } from '@/lib/config';
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
type Facts = { storageReachable: boolean; cronFresh: boolean; legalAllReviewed: boolean; legalCount: number };

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
    row({ key: 'vapid', kind: 'ops', label: 'Web-push keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)', status: has(env.VAPID_PUBLIC_KEY) && has(env.VAPID_PRIVATE_KEY) ? 'ok' : 'warn', blocking: false, fix: { kind: 'secret', names: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] }, detail: 'Run npm run vapid:generate. Push is simply off without them.' }),
    row({ key: 'legalReviewed', kind: 'ops', label: 'Every legal document marked reviewed by counsel', status: facts.legalAllReviewed ? 'ok' : 'warn', blocking: false, fix: { kind: 'link', href: '/admin/legal', text: 'Open legal documents' } }),
  ];
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
  const rows = buildGoLiveRows(s, env, { storageReachable, cronFresh: !cron.stale, legalCount: docs.length, legalAllReviewed: docs.length > 0 && docs.every((d) => d.reviewStatus === 'reviewed') });
  return { rows, blockers: liveBlockers(rows), mockMode: isMockMode() };
}
