import { headers } from 'next/headers';

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). There's no static "canonical site URL" env var anywhere in this
 * app, and the pilot deploys behind Replit's reverse proxy (a different host
 * per deployment) — so an absolute origin for server-rendered metadata
 * (Open Graph image resolution) is derived from the request's forwarded
 * headers instead of being hardcoded or requiring a new env var.
 */
export function siteOrigin(): string {
  const h = headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}
