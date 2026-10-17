import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api';
import { getDb, rowsOf } from '@/lib/db';

/**
 * Postgres-backed fixed-window rate limiter (table `rate_limits`), so the
 * limit holds across every Autoscale instance instead of being per-process.
 *
 * One atomic upsert per call: if the stored window has expired it restarts at
 * count 1, otherwise the count is incremented. The caller is rejected once the
 * count exceeds `limit` inside the window.
 */
export type RateLimitOptions = {
  /** requests allowed per window */
  limit: number;
  /** window length in ms */
  windowMs: number;
};

/**
 * Best-effort caller IP from proxy headers (Replit and most PaaS set
 * x-forwarded-for). Falls back to a constant when absent, which merges all
 * such callers into one shared bucket — acceptable degradation, not a bypass.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/** Throws ApiError(429) once `key` has exceeded `limit` requests per `windowMs`. */
export async function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): Promise<void> {
  // E2E runs share one IP and log in dozens of times; never active in production.
  if (process.env.E2E === 'true' && process.env.NODE_ENV !== 'production') return;
  const db = await getDb();
  const windowSec = windowMs / 1000;
  const res = await db.execute(sql`
    INSERT INTO rate_limits AS r (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN r.window_start < now() - (${windowSec} * interval '1 second') THEN 1 ELSE r.count + 1 END,
      window_start = CASE WHEN r.window_start < now() - (${windowSec} * interval '1 second') THEN now() ELSE r.window_start END
    RETURNING count, EXTRACT(EPOCH FROM (window_start + (${windowSec} * interval '1 second') - now())) AS retry_sec
  `);
  const row = rowsOf<{ count: number | string; retry_sec: number | string }>(res)[0];
  const count = Number(row?.count ?? 1);
  if (count > limit) {
    const retry = Math.max(1, Math.ceil(Number(row?.retry_sec ?? windowSec)));
    throw new ApiError(429, `Too many attempts — try again in ${retry}s`);
  }
}

/** Housekeeping: drop windows older than a day. Called opportunistically from the cron route. */
export async function pruneRateLimits(): Promise<void> {
  const db = await getDb();
  await db.execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
