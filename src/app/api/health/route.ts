import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStorage } from '@/lib/storage';
import { log } from '@/lib/log';

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
  const healthy = Object.values(checks).every((v) => v === 'ok');
  return NextResponse.json({ status: healthy ? 'ok' : 'degraded', checks, time: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
