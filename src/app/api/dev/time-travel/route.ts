import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { fssaiApplications, kitchenSubscriptions, orders } from '@/lib/db/schema';
import { runScheduledJobs } from '@/lib/jobs';
import { DAY_MS } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * E2E ONLY (NODE_ENV!=='production' AND E2E=true): simulates the passage of
 * time by moving a kitchen's subscription / FSSAI filing dates into the
 * past, then runs the scheduled jobs. 404 everywhere else.
 */
export const POST = api(async (req) => {
  if (process.env.NODE_ENV === 'production' || process.env.E2E !== 'true') throw new ApiError(404, 'Not found');
  const body = await readJson<{ kind: 'subscription' | 'fssai_filed' | 'order_accept_deadline' | 'order_age' | 'order_completed_ago'; sellerId: number; days: number; orderId?: number; minutes?: number }>(req);
  const db = await getDb();
  const shift = body.days * DAY_MS;
  if (body.kind === 'order_accept_deadline' && body.orderId) {
    await db.update(orders).set({ acceptBy: new Date(Date.now() - 1000) }).where(eq(orders.id, body.orderId));
    return ok({ jobs: await runScheduledJobs() });
  }
  if (body.kind === 'order_age' && body.orderId) {
    // Pretend N minutes have passed since the order's last timestamps (door wait, payment-claim window, confirm window).
    const [o] = await db.select().from(orders).where(eq(orders.id, body.orderId));
    const back = (d: Date | null) => (d ? new Date(d.getTime() - (body.minutes ?? 0) * 60_000) : d);
    if (o) await db.update(orders).set({ atDoorAt: back(o.atDoorAt), collectedAt: back(o.collectedAt), foodPaymentClaimedAt: back(o.foodPaymentClaimedAt) }).where(eq(orders.id, o.id));
    return ok({ jobs: await runScheduledJobs(new Date()) });
  }
  if (body.kind === 'order_completed_ago' && body.orderId) {
    // Make the order look completed N minutes ago (chat read-only window).
    await db.update(orders).set({ status: 'completed', completedAt: new Date(Date.now() - (body.minutes ?? 0) * 60_000) }).where(eq(orders.id, body.orderId));
    return ok({ ok: true });
  }
  if (body.kind === 'subscription') {
    const subs = await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.sellerId, body.sellerId));
    for (const s of subs) {
      if (!s.startsAt || !s.endsAt) continue;
      await db.update(kitchenSubscriptions).set({ startsAt: new Date(s.startsAt.getTime() - shift), endsAt: new Date(s.endsAt.getTime() - shift) }).where(eq(kitchenSubscriptions.id, s.id));
    }
  } else {
    const apps = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, body.sellerId));
    for (const a of apps) if (a.filedAt) await db.update(fssaiApplications).set({ filedAt: new Date(a.filedAt.getTime() - shift) }).where(eq(fssaiApplications.id, a.id));
  }
  return ok({ jobs: await runScheduledJobs() });
});
