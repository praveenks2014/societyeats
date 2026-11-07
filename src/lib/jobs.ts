import { recordCronRun } from '@/lib/cron-status';
import { runOrderTimers } from '@/lib/orders/lifecycle';
import { pruneRateLimits } from '@/lib/rate-limit';
import { syncSubscriptions } from '@/lib/subscriptions/service';

/** Everything the scheduler runs, in one idempotent pass. */
export async function runScheduledJobs(now: Date = new Date()) {
  const orderTimers = await runOrderTimers(now);
  const subs = await syncSubscriptions(now);
  const { runFssaiJobs } = await import('@/lib/fssai/jobs');
  const fssai = await runFssaiJobs(now);
  const { alertOverdueGrievances } = await import('@/lib/grievances');
  const grievanceAlerts = await alertOverdueGrievances(now);
  const { runRetention } = await import('@/lib/retention');
  const retention = await runRetention(now);
  const { plusReminders } = await import('@/lib/plus');
  const plusExpiring = await plusReminders(now);
  await pruneRateLimits();
  await recordCronRun(now);
  // Operational watchdog: a storage failure (or a late run that just recovered) is an alert, never a blocked order.
  let storageOk = true;
  try {
    await (await (await import('@/lib/storage')).getStorage()).ping();
  } catch {
    storageOk = false;
  }
  const { checkOpsHealth } = await import('@/lib/ops-alerts');
  const ops = await checkOpsHealth(now, { storageOk, cronStale: false, cronAgeMinutes: 0 });
  return { orderTimers, subscriptions: subs, fssai, retention, grievanceAlerts, plusExpiring, ops };
}
