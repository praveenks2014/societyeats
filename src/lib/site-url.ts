import { headers } from 'next/headers';

/**
 * Absolute origin for links in emails, share messages and Open Graph tags.
 * SITE_URL wins when set (stable across Replit deployments and usable from
 * background jobs); otherwise it is derived from the request's forwarded
 * headers.
 */
export function siteOrigin(): string {
  const fixed = process.env.SITE_URL?.trim().replace(/\/$/, '');
  if (fixed) return fixed;
  const h = headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

/** Never throws — falls back to localhost outside a request (cron, scripts). */
export function siteOriginSafe(): string {
  try {
    return siteOrigin();
  } catch {
    return process.env.SITE_URL?.trim().replace(/\/$/, '') || 'http://localhost:3000';
  }
}
