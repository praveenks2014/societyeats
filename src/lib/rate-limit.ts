import { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api';

/**
 * Minimal in-memory token-bucket rate limiter for auth and order endpoints.
 *
 * Buckets live in a module-level Map scoped to this one server process —
 * fine for the single-instance pilot deployment (no Redis/queue infra
 * anywhere else in this app either). Swap for a shared store before
 * scaling to multiple instances behind a load balancer, or the limit
 * becomes "per instance" instead of "per caller".
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5000; // safety valve against unbounded growth over a long uptime

export type RateLimitOptions = {
  /** requests allowed per window (also the max burst size) */
  limit: number;
  /** window length in ms over which the bucket fully refills */
  windowMs: number;
};

/**
 * Best-effort caller IP from proxy headers (Replit and most PaaS set
 * x-forwarded-for). Falls back to a constant when absent, which merges all
 * such callers into one shared bucket — acceptable degradation, not a
 * bypass, since the limit still applies.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/** Throws ApiError(429) once `key` has exceeded `limit` requests per `windowMs`; otherwise spends one token. */
export function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): void {
  const now = Date.now();
  const refillPerMs = limit / windowMs;

  if (buckets.size > MAX_TRACKED_KEYS) {
    // Cheap opportunistic eviction instead of a scheduled sweep — no timers,
    // matching this codebase's "no background jobs" convention.
    for (const [k, b] of buckets) {
      if (now - b.updatedAt > windowMs) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  const elapsed = now - bucket.updatedAt;
  bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
    throw new ApiError(429, `Too many attempts — try again in ${retryAfterSec}s`);
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
}
