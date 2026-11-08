import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStorage } from '@/lib/storage';
import { log } from '@/lib/log';
import { isMockMode } from '@/lib/config';
import { paymentsModeInfo } from '@/lib/payments/mode';
import { emailMode } from '@/lib/email';
import { getCronStatus } from '@/lib/cron-status';

export const dynamic = 'force-dynamic';

/** Liveness + dependency check for the Replit health probe and external monitors. */
export async function GET() {
  const checks: Record<string, 'ok' | string> = {};
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    checks.db = 'ok';
  } catch (e) {
    checks.db = 'fail';
    log.error('health.db', { err: e });
  }
  try {
    await (await getStorage()).ping();
    checks.storage = 'ok';
  } catch (e) {
    checks.storage = 'fail';
    log.error('health.storage', { err: e });
  }
  let cronAgeMinutes: number | null = null;
  try {
    const c = await getCronStatus();
    cronAgeMinutes = c.lastRunAt ? Math.round((Date.now() - c.lastRunAt.getTime()) / 60_000) : null;
  } catch {
    /* heartbeat is informational; it never fails the probe */
  }
  // The probe doubles as the cron-staleness watchdog: external monitors call this even when the scheduler has stopped.
  try {
    const { checkOpsHealth, currentCronFacts } = await import('@/lib/ops-alerts');
    await checkOpsHealth(new Date(), { storageOk: checks.storage === 'ok', ...(await currentCronFacts()) });
  } catch {
    /* alerting never fails the probe */
  }
  const healthy = Object.values(checks).every((v) => v === 'ok');
  return NextResponse.json({ status: healthy ? 'ok' : 'degraded', checks, cronAgeMinutes, mockMode: isMockMode(), paymentsMode: paymentsModeInfo().mode ?? 'invalid_key', emailMode: emailMode(), time: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
