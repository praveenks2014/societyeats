import { autoCancelUnaccepted, expireUnpaidOrders, remindUnconfirmedPayments } from '@/lib/orders/lifecycle';
import { pruneRateLimits } from '@/lib/rate-limit';
import { syncSubscriptions } from '@/lib/subscriptions/service';

/** Everything the scheduler runs, in one idempotent pass. */
export async function runScheduledJobs(now: Date = new Date()) {
  const expiredOrders = await expireUnpaidOrders(now);
  const autoCancelled = await autoCancelUnaccepted(now);
  const reminders = await remindUnconfirmedPayments(now);
  const subs = await syncSubscriptions(now);
  const { runFssaiJobs } = await import('@/lib/fssai/jobs');
  const fssai = await runFssaiJobs(now);
  await pruneRateLimits();
  return { expiredOrders, autoCancelled, paymentReminders: reminders, subscriptions: subs, fssai };
}
