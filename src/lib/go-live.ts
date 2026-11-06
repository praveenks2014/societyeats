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
  /** Blocking rows stop live mode (MOCK_MODE=false); the others are warnings. */
  blocking: boolean;
  /** Where / how to fix it. `setting` rows have an inline form in /admin/go-live. */
  fix: { kind: 'setting'; keys: string[] } | { kind: 'secret'; names: string[] } | { kind: 'link'; href: string; text: string } | { kind: 'info'; text: string };
  detail?: string;
};

type Env = Record<string, string | undefined>;
type Facts = { storageReachable: boolean; cronFresh: boolean; legalAllReviewed: boolean; legalCount: number };

/**
 * The single list of live-mode prerequisites. The /admin/go-live page renders it and the live-mode
 * guard blocks on exactly its `blocking` rows, so the two can never disagree. Pure: facts are passed in.
 */
export function buildGoLiveRows(s: PlatformSettings, env: Env, facts: Facts): GoLiveRow[] {
  const has = (v: string | undefined) => !!v?.trim();
  const row = (r: GoLiveRow) => r;
  return [
    row({ key: 'platformFssaiCentralLicenseNo', label: 'Platform FSSAI Central licence number', status: has(s.platformFssaiCentralLicenseNo) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['platformFssaiCentralLicenseNo'] }, detail: 'E-commerce operators need a Central licence. 14 digits.' }),
    row({ key: 'gstPosition', label: 'GST position confirmed by your CA (mode, note, date)', status: has(s.gstPositionConfirmedAt) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['gstMode', 'platformGstin', 'gstPositionConfirmedAt', 'gstPositionNote'] }, detail: `Current mode: ${s.gstMode}.` }),
    row({ key: 'legalEntity', label: 'Legal entity name and registered address', status: has(s.legalEntityName) && has(s.registeredAddress) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['legalEntityName', 'registeredAddress'] } }),
    row({ key: 'grievanceOfficer', label: 'Grievance officer (name, designation, email, phone)', status: has(s.grievanceOfficer) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['grievanceOfficer', 'supportEmail', 'supportPhone'] } }),
    row({ key: 'support', label: 'Support email and phone', status: has(s.supportEmail) && has(s.supportPhone) ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['supportEmail', 'supportPhone'] } }),
    row({ key: 'razorpayKeys', label: 'Razorpay live keys (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)', status: has(env.RAZORPAY_KEY_ID) && has(env.RAZORPAY_KEY_SECRET) ? 'ok' : 'missing', blocking: true, fix: { kind: 'secret', names: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] } }),
    row({ key: 'razorpayWebhook', label: 'Razorpay webhook secret (RAZORPAY_WEBHOOK_SECRET)', status: has(env.RAZORPAY_WEBHOOK_SECRET) ? 'ok' : 'missing', blocking: true, fix: { kind: 'secret', names: ['RAZORPAY_WEBHOOK_SECRET'] }, detail: 'Events: payment.authorized, payment.captured, payment.failed, refund.processed, refund.failed (+ fund_account.validation.* for RazorpayX).' }),
    row({ key: 'upiProvider', label: 'UPI ownership check is not the mock provider', status: s.upiVerifyProvider !== 'mock' ? 'ok' : 'missing', blocking: true, fix: { kind: 'setting', keys: ['upiVerifyProvider'] }, detail: `Current: ${s.upiVerifyProvider}.` }),
    row({ key: 'storage', label: 'File storage reachable (Replit Object Storage or S3)', status: facts.storageReachable ? 'ok' : 'missing', blocking: true, fix: { kind: 'info', text: 'Set STORAGE_ADAPTER=replit and create the Object Storage bucket; check /api/health.' } }),
    row({ key: 'cron', label: 'Scheduled jobs are running (heartbeat fresh)', status: facts.cronFresh ? 'ok' : 'missing', blocking: true, fix: { kind: 'info', text: 'Schedule POST /api/cron/run every 5 minutes with the cron secret.' } }),
    row({ key: 'vapid', label: 'Web-push keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)', status: has(env.VAPID_PUBLIC_KEY) && has(env.VAPID_PRIVATE_KEY) ? 'ok' : 'warn', blocking: false, fix: { kind: 'secret', names: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] }, detail: 'Run npm run vapid:generate. Push is simply off without them.' }),
    row({ key: 'legalReviewed', label: 'Every legal document marked reviewed by counsel', status: facts.legalAllReviewed ? 'ok' : 'warn', blocking: false, fix: { kind: 'link', href: '/admin/legal', text: 'Open legal documents' } }),
  ];
}

export function liveBlockers(rows: GoLiveRow[]): GoLiveRow[] {
  return rows.filter((r) => r.blocking && r.status !== 'ok');
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
