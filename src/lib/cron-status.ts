import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { platformConfig } from '@/lib/db/schema';
import { setPlatformSetting } from '@/lib/db/platform';

/** Autoscale has no built-in cron, so the last successful scheduled run is stored and /admin warns when it goes stale. */
const KEY = 'cronLastRunAt';
export const CRON_STALE_MS = 3 * 60 * 60_000;

export async function recordCronRun(now: Date = new Date()): Promise<void> {
  await setPlatformSetting(KEY, now.toISOString());
}

export async function getCronStatus(now: Date = new Date()): Promise<{ lastRunAt: Date | null; stale: boolean }> {
  const db = await getDb();
  const [row] = await db.select().from(platformConfig).where(eq(platformConfig.key, KEY));
  const t = row ? new Date(row.value) : null;
  const lastRunAt = t && !Number.isNaN(t.getTime()) ? t : null;
  return { lastRunAt, stale: !lastRunAt || now.getTime() - lastRunAt.getTime() > CRON_STALE_MS };
}
