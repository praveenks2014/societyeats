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
  const { runRetention } = await import('@/lib/retention');
  const retention = await runRetention(now);
  await pruneRateLimits();
  await recordCronRun(now);
  return { orderTimers, subscriptions: subs, fssai, retention };
}
