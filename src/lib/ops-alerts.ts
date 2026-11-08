import { eq } from 'drizzle-orm';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { platformConfig } from '@/lib/db/schema';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { getCronStatus } from '@/lib/cron-status';
import { emitToAdmins } from '@/lib/notify';

/**
 * Operational health is alerted on, never used to stop an order. For each check the state is
 * { open: an incident is in progress, alertedAt: when admins were last told, alerted: they were told about THIS incident }.
 * One alert per incident (a flapping check inside the 2-hour cooldown does not re-alert), then one recovery notice if an alert went out.
 */
const KEY = 'opsAlertState';
export const OPS_ALERT_COOLDOWN_MS = 2 * 60 * 60_000;

type CheckState = { open: boolean; alerted: boolean; alertedAt: string | null };
type State = Record<string, CheckState>;
const EMPTY: CheckState = { open: false, alerted: false, alertedAt: null };

async function readState(): Promise<State> {
  const db = await getDb();
  const [row] = await db.select().from(platformConfig).where(eq(platformConfig.key, KEY));
  try {
    return row ? (JSON.parse(row.value) as State) : {};
  } catch {
    return {};
  }
}

export type OpsFacts = { storageOk: boolean; cronStale: boolean; cronAgeMinutes?: number | null; /** the last database backup failed, or the last good one is over 26 hours old */ backupBad?: boolean };

/** Pure transition: what to send for one check given its previous state. */
export function opsTransition(prev: CheckState, bad: boolean, now: Date): { next: CheckState; send: 'alert' | 'recovered' | null } {
  if (bad) {
    if (prev.open) return { next: prev, send: null };
    const recentlyAlerted = prev.alertedAt && now.getTime() - new Date(prev.alertedAt).getTime() < OPS_ALERT_COOLDOWN_MS;
    if (recentlyAlerted) return { next: { open: true, alerted: false, alertedAt: prev.alertedAt }, send: null };
    return { next: { open: true, alerted: true, alertedAt: now.toISOString() }, send: 'alert' };
  }
  if (!prev.open) return { next: prev, send: null };
  return { next: { open: false, alerted: false, alertedAt: prev.alertedAt }, send: prev.alerted ? 'recovered' : null };
}

const TEXT: Record<'storage' | 'cron' | 'backup', { what: string; bad: (f: OpsFacts, staleMin: number) => string; good: string }> = {
  storage: { what: 'file storage', bad: () => 'Object Storage did not answer. Orders keep working; photo and document uploads may fail until it is back.', good: 'File storage answers again.' },
  backup: { what: 'database backups', bad: () => 'The daily database backup failed or is overdue. Open Admin → Go-live → Backups for the error, then press “Run backup now”. Orders keep working, but there is no fresh copy of the data until a backup succeeds.', good: 'A database backup completed.' },
  cron: {
    what: 'scheduled jobs',
    bad: (f, m) => `The scheduled-jobs endpoint has not run for ${f.cronAgeMinutes == null ? 'a long time' : `${f.cronAgeMinutes} minutes`} (alert after ${m}). Orders keep working; timers (accept deadlines, refunds on expiry, reminders) are late until it runs. Check the cron-job.org schedule (every 5 minutes).`,
    good: 'Scheduled jobs are running again.',
  },
};

/**
 * Compares the facts with the stored incident state and tells both admins (in-app + email) once per incident, then once on recovery.
 * Never throws: a failing alert must not break the request that triggered it. Mock mode has nothing to alert about.
 */
export async function checkOpsHealth(now: Date = new Date(), facts: OpsFacts): Promise<{ alerts: string[]; recovered: string[] }> {
  const out = { alerts: [] as string[], recovered: [] as string[] };
  if (isMockMode()) return out;
  try {
    const settings = await getPlatformSettings();
    const state = await readState();
    const bad: Record<'storage' | 'cron' | 'backup', boolean> = { storage: !facts.storageOk, cron: facts.cronStale, backup: !!facts.backupBad };
    let changed = false;
    for (const k of ['storage', 'cron', 'backup'] as const) {
      if (k === 'backup' && facts.backupBad === undefined) continue; // the health probe does not know about backups: leave that incident alone
      const { next, send } = opsTransition(state[k] ?? EMPTY, bad[k], now);
      if (JSON.stringify(next) !== JSON.stringify(state[k] ?? EMPTY)) {
        state[k] = next;
        changed = true;
      }
      if (send === 'alert') {
        await emitToAdmins('ops_alert', { what: TEXT[k].what, detail: TEXT[k].bad(facts, Number(settings.cronStaleMinutes)) }, now);
        out.alerts.push(k);
      } else if (send === 'recovered') {
        await emitToAdmins('ops_recovered', { what: TEXT[k].what, detail: TEXT[k].good }, now);
        out.recovered.push(k);
      }
    }
    if (changed) await setPlatformSetting(KEY, JSON.stringify(state));
  } catch {
    /* alerting is best effort */
  }
  return out;
}

/** Reads the cron heartbeat for `checkOpsHealth` callers that do not already have it. */
export async function currentCronFacts(now: Date = new Date()): Promise<{ cronStale: boolean; cronAgeMinutes: number | null }> {
  const s = await getPlatformSettings();
  const c = await getCronStatus(now, Number(s.cronStaleMinutes) * 60_000).catch(() => ({ stale: true, lastRunAt: null as Date | null }));
  return { cronStale: c.stale, cronAgeMinutes: c.lastRunAt ? Math.round((now.getTime() - c.lastRunAt.getTime()) / 60_000) : null };
}
