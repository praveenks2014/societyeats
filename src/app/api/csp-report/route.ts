import { NextResponse } from 'next/server';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Browsers post CSP violations here. We keep only the directive and the blocked origin (no query strings, no page URLs with ids). */
export async function POST(req: Request) {
  try {
    const text = (await req.text()).slice(0, 4000);
    const j = JSON.parse(text) as unknown;
    const first = (Array.isArray(j) ? j[0]?.body : (j as { 'csp-report'?: unknown })['csp-report']) as Record<string, unknown> | undefined;
    const strip = (v: unknown) => String(v ?? '').split('?')[0].slice(0, 200);
    log.warn('csp.violation', { directive: strip(first?.['effectiveDirective'] ?? first?.['violated-directive']), blocked: strip(first?.['blockedURL'] ?? first?.['blocked-uri']) });
  } catch {
    /* ignore malformed reports */
  }
  return new NextResponse(null, { status: 204 });
}
