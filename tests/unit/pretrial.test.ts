import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { call, jsonReq, loginAs } from '../helpers/http';
import { makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { buildGoLiveRows, liveBlockers } from '@/lib/go-live';
import { SETTING_DEFS } from '@/lib/settings/defs';
import { classifyEmailError, emailDeliveryFacts, fromDomainProblem } from '@/lib/email/status';
import { MemoryStorage } from '@/lib/storage/memory';
import { setStorageForTests } from '@/lib/storage';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
const saved = { ...process.env };
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  db = await useTestDb();
  setStorageForTests(new MemoryStorage());
  societyId = (await makeSociety(db)).id;
});
afterEach(() => {
  for (const k of ['EMAIL_ADAPTER', 'EMAIL_FROM', 'MOCK_MODE', 'ADMIN_EMAILS']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const settings = Object.fromEntries(Object.entries(SETTING_DEFS).map(([k, d]) => [k, (d as { def: unknown }).def])) as never;
const base = { storageReachable: true, cronFresh: true, legalAllReviewed: true, legalCount: 1 };
const row = (key: string, f: Record<string, unknown>) => buildGoLiveRows(settings, {}, { ...base, ...f }).find((r) => r.key === key)!;

describe('T3: email delivery status', () => {
  test('the go-live row: red in mock, amber for a failing or test-domain Resend, green when the last send worked', () => {
    expect(row('emailDelivery', { email: { mode: 'mock', lastSend: null, fromProblem: null } })).toMatchObject({ status: 'missing', kind: 'ops', blocking: false, detail: expect.stringContaining('/admin/outbox only, residents will not receive them') });
    expect(row('emailDelivery', { email: { mode: 'resend', lastSend: { ok: true, errorClass: null }, fromProblem: null } })).toMatchObject({ status: 'ok' });
    expect(row('emailDelivery', { email: { mode: 'resend', lastSend: null, fromProblem: null } })).toMatchObject({ status: 'ok' });
    expect(row('emailDelivery', { email: { mode: 'resend', lastSend: { ok: false, errorClass: 'api_key' }, fromProblem: null } })).toMatchObject({ status: 'warn', detail: expect.stringContaining('api_key') });
    expect(row('emailDelivery', { email: { mode: 'resend', lastSend: { ok: false, errorClass: 'domain_not_verified' }, fromProblem: null } })).toMatchObject({ status: 'warn', detail: expect.stringContaining('verify the domain') });
    expect(row('emailDelivery', { email: { mode: 'resend', lastSend: { ok: true, errorClass: null }, fromProblem: 'test_domain' } })).toMatchObject({ status: 'warn', detail: expect.stringContaining('resend.dev') });
    const all = buildGoLiveRows(settings, {}, { ...base, email: { mode: 'mock', lastSend: null, fromProblem: null } });
    expect(liveBlockers(all).map((r) => r.key)).not.toContain('emailDelivery'); // never blocks an order
  });

  test('error classes and the sender-domain check show a class, never the provider text', () => {
    expect(classifyEmailError('You can only send testing emails to your own email address (x@y.com). To send emails to other recipients, please verify a domain')).toBe('domain_not_verified');
    expect(classifyEmailError('The from address is not verified')).toBe('domain_not_verified');
    expect(classifyEmailError('API key is invalid')).toBe('api_key');
    expect(classifyEmailError('RESEND_API_KEY missing')).toBe('api_key');
    expect(classifyEmailError('resend 429')).toBe('rate_limited');
    expect(classifyEmailError('fetch failed')).toBe('network');
    expect(classifyEmailError('boom')).toBe('other');
    expect(fromDomainProblem('PadosiPlate <onboarding@resend.dev>')).toBe('test_domain');
    expect(fromDomainProblem(undefined)).toBe('test_domain');
    expect(fromDomainProblem('PadosiPlate <no-reply@padosiplate.example>')).toBe('test_domain');
    expect(fromDomainProblem('PadosiPlate <hello@padosiplate.in>')).toBeNull();
  });

  test('EMAIL_ADAPTER=resend wins over MOCK_MODE=true, and the facts come from the last real send', async () => {
    process.env.MOCK_MODE = 'true';
    delete process.env.EMAIL_ADAPTER;
    expect((await emailDeliveryFacts({})).mode).toBe('mock');
    process.env.EMAIL_ADAPTER = 'resend';
    expect(await emailDeliveryFacts({ EMAIL_FROM: 'A <hello@padosiplate.in>' })).toEqual({ mode: 'resend', lastSend: null, fromProblem: null });
    await db.insert(s.emailOutbox).values({ toEmail: 'a@x.in', subject: 's', bodyText: 'b', kind: 'k', status: 'sent' });
    await db.insert(s.emailOutbox).values({ toEmail: 'b@x.in', subject: 's', bodyText: 'b', kind: 'k', status: 'failed', error: 'You can only send testing emails to your own email address' });
    expect(await emailDeliveryFacts({ EMAIL_FROM: 'A <hello@padosiplate.in>' })).toMatchObject({ lastSend: { ok: false, errorClass: 'domain_not_verified' } });
    await db.insert(s.emailOutbox).values({ toEmail: 'c@x.in', subject: 's', bodyText: 'b', kind: 'k', status: 'sent' });
    expect(await emailDeliveryFacts({ EMAIL_FROM: 'A <hello@padosiplate.in>' })).toMatchObject({ lastSend: { ok: true, errorClass: null } });
  });

  test('/api/health reports emailMode', async () => {
    const { GET } = await import('@/app/api/health/route');
    process.env.MOCK_MODE = 'true';
    delete process.env.EMAIL_ADAPTER;
    expect(await (await GET()).json()).toMatchObject({ emailMode: 'mock' });
    process.env.EMAIL_ADAPTER = 'resend';
    expect(await (await GET()).json()).toMatchObject({ emailMode: 'resend' });
  });
});

describe('T2: backups in the admin console', () => {
  test('the go-live "Database backups" row: amber with none, a failure or an age over 26 hours; green otherwise; never blocking', () => {
    const now = new Date('2026-12-01T10:00:00Z');
    const b = (over: Record<string, unknown>) => row('backups', { now, backup: { lastSuccessAt: null, bytes: null, method: null, lastAttemptFailed: false, errorShort: null, ...over } });
    expect(b({})).toMatchObject({ status: 'warn', kind: 'ops', blocking: false, detail: expect.stringContaining('No backup has been taken yet') });
    expect(b({ lastSuccessAt: '2026-12-01T00:00:00Z', bytes: 204_800, method: 'logical' })).toMatchObject({ status: 'ok', detail: expect.stringMatching(/200 KB, logical/) });
    expect(b({ lastSuccessAt: '2026-11-30T06:00:00Z', bytes: 1024, method: 'logical' })).toMatchObject({ status: 'warn', detail: expect.stringContaining('over 26 hours') });
    expect(b({ lastSuccessAt: '2026-12-01T00:00:00Z', bytes: 1024, method: 'logical', lastAttemptFailed: true, errorShort: 'bucket unavailable' })).toMatchObject({ status: 'warn', detail: expect.stringContaining('bucket unavailable') });
    expect(liveBlockers(buildGoLiveRows(settings, {}, { ...base, now, backup: { lastSuccessAt: null, bytes: null, method: null, lastAttemptFailed: true, errorShort: 'x' } })).map((r) => r.key)).not.toContain('backups');
  });

  test('"Run backup now": admin only, needs a fresh 2FA check, writes an audit entry, and returns the backup', async () => {
    const admin = await makeUser(db, 'admin', { societyId });
    process.env.ADMIN_EMAILS = admin.email!;
    const buyer = await makeUser(db, 'buyer', { societyId });
    const { POST, GET } = await import('@/app/api/admin/backup/route');
    await loginAs(buyer.id);
    expect((await call(POST as never, jsonReq('/api/admin/backup', {}))).status).toBe(403);
    await loginAs(admin.id, { mfa: false });
    expect((await call(POST as never, jsonReq('/api/admin/backup', {}))).status).toBe(403);
    await loginAs(admin.id, { mfa: true });
    const r = await call(POST as never, jsonReq('/api/admin/backup', {}));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ backup: { method: 'logical', key: expect.stringMatching(/^backups\//) } });
    const audit = (await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'backup.run')))[0];
    expect(audit).toMatchObject({ actorId: admin.id });
    const g = await call(GET as never, jsonReq('/api/admin/backup', undefined, { method: 'GET' }));
    expect((g.json.backups as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(g.json).toMatchObject({ state: { ok: true, trigger: 'manual' } });
  });

  test('a backup failure raises one admin alert per incident, a recovery notice after, and the health probe leaves it alone', async () => {
    const { checkOpsHealth } = await import('@/lib/ops-alerts');
    process.env.MOCK_MODE = 'false';
    const a1 = await makeUser(db, 'admin', { societyId });
    process.env.ADMIN_EMAILS = a1.email!;
    const count = async (key: string) => (await db.select().from(s.notifications)).filter((n) => n.eventKey === key && n.userId === a1.id && /backup/i.test(n.title)).length;
    const ok = { storageOk: true, cronStale: false };
    const t = new Date('2027-05-01T10:00:00Z');
    expect((await checkOpsHealth(t, { ...ok, backupBad: true })).alerts).toEqual(['backup']);
    await checkOpsHealth(new Date(t.getTime() + 300_000), { ...ok, backupBad: true });
    expect(await count('ops_alert')).toBe(1);
    await checkOpsHealth(new Date(t.getTime() + 400_000), ok); // the health probe has no opinion on backups
    expect(await count('ops_recovered')).toBe(0);
    expect((await checkOpsHealth(new Date(t.getTime() + 600_000), { ...ok, backupBad: false })).recovered).toEqual(['backup']);
    expect(await count('ops_recovered')).toBe(1);
  });
});

describe('T4: compare the legal text with the latest seed draft', () => {
  test('lineDiff: identical, added, removed and changed lines', async () => {
    const { lineDiff, diffStats } = await import('@/lib/diff');
    expect(diffStats(lineDiff('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0, same: 2 });
    expect(lineDiff('a\nb', 'a\nc\nb')).toEqual([{ type: 'same', text: 'a' }, { type: 'add', text: 'c' }, { type: 'same', text: 'b' }]);
    expect(lineDiff('a\nb\nc', 'a\nc')).toEqual([{ type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' }]);
    expect(diffStats(lineDiff('one\ntwo', 'one\nTWO'))).toEqual({ added: 1, removed: 1, same: 1 });
    expect(diffStats(lineDiff('', 'x'))).toEqual({ added: 1, removed: 1, same: 0 }); // '' is one empty line
  });

  test('compare is read-only; loading the seed needs 2FA, writes nothing and never publishes; an admin-edited document is flagged', async () => {
    const admin = await makeUser(db, 'admin', { societyId });
    process.env.ADMIN_EMAILS = admin.email!;
    const { GET, POST } = await import('@/app/api/admin/legal/[slug]/route');
    const p = { slug: 'terms' };
    await loginAs(admin.id, { mfa: true });
    const first = await call(GET as never, jsonReq('/x?compare=seed', undefined, { method: 'GET' }), p);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ identical: true, adminEdited: false });

    // an admin publishes their own edit
    const live = (await call(GET as never, jsonReq('/x', undefined, { method: 'GET' }), p)).json.document as { body: string; version: number };
    const edited = `${live.body}\n\nAn edit made by an admin, counsel-approved wording.`;
    const pub = await call(POST as never, jsonReq('/x', { action: 'publish', title: 'Terms of use', body: edited, material: false, changeSummary: 'Edited by the admin' }), p);
    expect(pub.status, JSON.stringify(pub.json)).toBe(200);

    const cmp = await call(GET as never, jsonReq('/x?compare=seed', undefined, { method: 'GET' }), p);
    expect(cmp.json).toMatchObject({ identical: false, adminEdited: true, current: { version: live.version + 1 } });
    expect((cmp.json.seed as { body: string }).body).toBe(live.body);

    const snapshot = async () => ({ doc: (await db.select().from(s.legalDocuments).where(eq(s.legalDocuments.slug, 'terms')))[0], versions: await db.select().from(s.legalDocumentVersions).where(eq(s.legalDocumentVersions.slug, 'terms')) });
    const before = await snapshot();

    // a stale 2FA check is refused; a fresh one hands over the seed text only
    await loginAs(admin.id, { mfa: false });
    expect((await call(POST as never, jsonReq('/x', { action: 'load_seed_draft' }), p)).status).toBe(403);
    await loginAs(admin.id, { mfa: true });
    const load = await call(POST as never, jsonReq('/x', { action: 'load_seed_draft' }), p);
    expect(load.status, JSON.stringify(load.json)).toBe(200);
    expect(load.json).toMatchObject({ body: live.body, adminEdited: true, liveVersion: live.version + 1 });

    // nothing was written: the live document and every stored version are exactly as they were
    expect(await snapshot()).toEqual(before);
    expect(before.doc.body).toBe(edited);
    expect((await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'legal.seed_draft_loaded'))).length).toBeGreaterThanOrEqual(1);

    // publishing the loaded draft is the normal separate step: it adds a version and leaves the admin's earlier version intact
    const again = await call(POST as never, jsonReq('/x', { action: 'publish', title: 'Terms of use', body: load.json.body, material: false, changeSummary: 'Back to the seed text' }), p);
    expect(again.status).toBe(200);
    const after = await snapshot();
    expect(after.versions.length).toBe(before.versions.length + 1);
    expect(after.versions.find((v) => v.version === live.version + 1)!.body).toBe(edited);
  });

  test('only admins can compare or load', async () => {
    const buyer = await makeUser(db, 'buyer', { societyId });
    const { GET, POST } = await import('@/app/api/admin/legal/[slug]/route');
    await loginAs(buyer.id);
    expect((await call(GET as never, jsonReq('/x?compare=seed', undefined, { method: 'GET' }), { slug: 'terms' })).status).toBe(403);
    expect((await call(POST as never, jsonReq('/x', { action: 'load_seed_draft' }), { slug: 'terms' })).status).toBe(403);
  });
});
