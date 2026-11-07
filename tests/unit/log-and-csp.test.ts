import { describe, expect, test, vi } from 'vitest';
import { buildCsp } from '@/proxy';
import { log, maskPii } from '@/lib/log';

describe('G3: CSP', () => {
  test('production policy: nonce + strict-dynamic, Razorpay allowed, no inline or eval scripts, reporting on', () => {
    const csp = buildCsp('abc123', false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://checkout.razorpay.com");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(buildCsp('n', true)).toContain("'unsafe-eval'");
  });
  test('the report endpoint accepts and drops reports without echoing them', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const r = await POST(new Request('http://x/api/csp-report', { method: 'POST', body: JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.test/x.js?a=1' } }) }));
    expect(r.status).toBe(204);
    expect((await POST(new Request('http://x/api/csp-report', { method: 'POST', body: 'not json' }))).status).toBe(204);
  });
});

describe('G4: logging has no PII', () => {
  test('masks phones and emails in free text and redacts PII keys', () => {
    expect(maskPii('call 9876543210 or +91 98765 43210? mail a.b@x.in')).not.toMatch(/9876543210|a\.b@x\.in/);
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((l) => void lines.push(String(l)));
    log.error('t', { phone: '9876543210', note: 'user a@b.co failed', err: new Error('bad 9876543210') });
    spy.mockRestore();
    expect(lines.join('')).not.toMatch(/9876543210|a@b\.co/);
  });
});
