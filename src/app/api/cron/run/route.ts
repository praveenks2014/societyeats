import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { log } from '@/lib/log';
import { runScheduledJobs } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

/**
 * Scheduled maintenance. Call hourly (or more often) from an external scheduler — Autoscale has no cron (cron-job.org,
 * GitHub Actions, a Replit Scheduled Deployment) with
 *   Authorization: Bearer $CRON_SECRET
 * Every job is idempotent, and the same work also happens lazily on reads, so
 * a missed run delays emails/cleanups but never breaks correctness.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret ?? '');
  if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runScheduledJobs();
  log.info('cron.run', result);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
