import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { fssaiApplications, kitchenSubscriptions } from '@/lib/db/schema';
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
  const body = await readJson<{ kind: 'subscription' | 'fssai_filed'; sellerId: number; days: number }>(req);
  const db = await getDb();
  const shift = body.days * DAY_MS;
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
