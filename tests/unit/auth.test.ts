import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, jsonReq } from '../helpers/http';
import { resetRequestContext } from '../helpers/next-headers';
import { useTestDb } from '../helpers/db';
import { societies, users, sessions, emailOutbox } from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
const PW = 'correct-horse-9';

async function register(over: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/auth/register/route');
  return call(POST, jsonReq('/api/auth/register', { phone: '9876543210', email: 'a@example.com', name: 'A', password: PW, inviteCode: 'TESTCODE', ...over }, { headers: { 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } }));
}
async function login(identifier: string, password = PW) {
  const { POST } = await import('@/app/api/auth/login/route');
  return call(POST, jsonReq('/api/auth/login', { identifier, password }, { headers: { 'x-forwarded-for': `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } }));
}
async function token(email: string, kind: 'verify_email' | 'reset_password') {
  const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email));
  const mail = rows.filter((r) => r.kind === kind).pop();
  return mail?.bodyText.match(/token=([\w-]+)/)?.[1] ?? '';
}

beforeAll(async () => {
  process.env.ADMIN_EMAILS = 'boss@example.com, Second@Example.com';
  db = await useTestDb();
  const [s] = await db.insert(societies).values({ name: 'T', city: 'H', lat: 17, lng: 78, addressText: 'x', inviteCode: 'TESTCODE', isLive: true }).returning();
  societyId = s.id;
});
beforeEach(() => resetRequestContext());

describe('registration and login', () => {
  test('rejects short and common passwords, bad phone, bad email', async () => {
    expect((await register({ password: 'abc123' })).status).toBe(400);
    expect((await register({ password: 'password123' })).status).toBe(400);
    expect((await register({ phone: '12345' })).status).toBe(400);
    expect((await register({ email: 'nope' })).status).toBe(400);
  });

  test('register → verification mail in outbox → verify → login by email or phone', async () => {
    const r = await register();
    expect(r.status).toBe(200);
    const t = await token('a@example.com', 'verify_email');
    expect(t.length).toBeGreaterThan(20);
    const { POST: verify } = await import('@/app/api/auth/verify-email/route');
    expect((await call(verify, jsonReq('/api/auth/verify-email', { token: t }))).status).toBe(200);
    // single use
    expect((await call(verify, jsonReq('/api/auth/verify-email', { token: t }))).status).toBe(400);
    expect((await login('a@example.com')).status).toBe(200);
    expect((await login('9876543210')).status).toBe(200);
    expect((await login('A@EXAMPLE.COM', 'wrong-password')).status).toBe(401);
    expect(societyId).toBeGreaterThan(0);
  });

  test('duplicate email or phone is rejected', async () => {
    expect((await register({ phone: '9876543211' })).status).toBe(409);
    expect((await register({ email: 'other@example.com' })).status).toBe(409);
  });
});

describe('admin allowlist', () => {
  test('allowlisted email is NOT admin until verified, then is (case-insensitive)', async () => {
    const { resolveSession } = await import('@/lib/auth');
    expect((await register({ phone: '9876543220', email: 'Second@example.com', name: 'Second' })).status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.email, 'second@example.com'));
    const [sess] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect((await resolveSession(sess.id))?.role).toBe('buyer');
    const t = await token('second@example.com', 'verify_email');
    const { POST: verify } = await import('@/app/api/auth/verify-email/route');
    const res = await call(verify, jsonReq('/api/auth/verify-email', { token: t }));
    expect(res.json.promoted).toBe(true);
    expect((await resolveSession(sess.id))?.role).toBe('admin');
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after.role).toBe('admin');
  });

  test('a non-allowlisted verified user can never be admin, even with role=admin in the DB', async () => {
    const { resolveSession } = await import('@/lib/auth');
    await register({ phone: '9876543221', email: 'sneaky@example.com', name: 'S' });
    const [u] = await db.select().from(users).where(eq(users.email, 'sneaky@example.com'));
    await db.update(users).set({ role: 'admin', emailVerifiedAt: new Date() }).where(eq(users.id, u.id));
    const [sess] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect((await resolveSession(sess.id))?.role).toBe('buyer');
  });

  test('removing an email from ADMIN_EMAILS demotes immediately', async () => {
    const { resolveSession } = await import('@/lib/auth');
    const [u] = await db.select().from(users).where(eq(users.email, 'second@example.com'));
    const [sess] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    process.env.ADMIN_EMAILS = 'boss@example.com';
    expect((await resolveSession(sess.id))?.role).toBe('buyer');
    process.env.ADMIN_EMAILS = 'boss@example.com, Second@Example.com';
  });

  test('bootstrap creates missing admins once with must_change_password and a one-time password', async () => {
    const { ensureAdminAccounts } = await import('@/lib/auth/admins');
    const first = await ensureAdminAccounts(db);
    expect(first.map((a) => a.email)).toEqual(['boss@example.com']);
    expect(first[0].password.length).toBeGreaterThanOrEqual(12);
    const [boss] = await db.select().from(users).where(eq(users.email, 'boss@example.com'));
    expect(boss).toMatchObject({ role: 'admin', mustChangePassword: true });
    expect(boss.emailVerifiedAt).not.toBeNull();
    expect(await ensureAdminAccounts(db)).toEqual([]); // idempotent
    // first login is flagged to change password, and API calls are refused until then
    const res = await login('boss@example.com', first[0].password);
    expect(res.json.mustChangePassword).toBe(true);
    const { requireSession } = await import('@/lib/auth');
    await expect(requireSession(['admin'])).rejects.toMatchObject({ status: 403 });
    await expect(requireSession(['admin'], { allowMustChange: true })).resolves.toMatchObject({ role: 'admin' });
  });
});

describe('sessions', () => {
  test('block kills sessions, logout-all kills the rest, password reset revokes and tokens are single-use', async () => {
    const { resolveSession } = await import('@/lib/auth');
    await register({ phone: '9876543230', email: 'sess@example.com', name: 'Sess' });
    const [u] = await db.select().from(users).where(eq(users.email, 'sess@example.com'));
    await login('sess@example.com');
    await login('9876543230');
    const mine = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(mine.length).toBe(3);
    expect(await resolveSession(mine[0].id)).not.toBeNull();

    const { POST: logoutAll } = await import('@/app/api/auth/logout-all/route');
    expect((await call(logoutAll, jsonReq('/api/auth/logout-all'))).status).toBe(200);
    expect((await db.select().from(sessions).where(eq(sessions.userId, u.id))).length).toBe(0);
    expect(await resolveSession(mine[0].id)).toBeNull();

    await login('sess@example.com');
    const [s2] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, u.id));
    expect(await resolveSession(s2.id)).toBeNull();
    expect((await login('sess@example.com')).status).toBe(403);
    await db.update(users).set({ blockedAt: null }).where(eq(users.id, u.id));

    const { POST: forgot } = await import('@/app/api/auth/forgot-password/route');
    await call(forgot, jsonReq('/api/auth/forgot-password', { identifier: 'sess@example.com' }));
    const t = await token('sess@example.com', 'reset_password');
    const { POST: reset } = await import('@/app/api/auth/reset-password/route');
    expect((await call(reset, jsonReq('/api/auth/reset-password', { token: t, password: 'short' }))).status).toBe(400);
    expect((await call(reset, jsonReq('/api/auth/reset-password', { token: t, password: 'a-brand-new-pass-1' }))).status).toBe(200);
    expect((await call(reset, jsonReq('/api/auth/reset-password', { token: t, password: 'another-pass-22' }))).status).toBe(400);
    expect(await resolveSession(s2.id)).toBeNull();
    expect((await login('sess@example.com', 'a-brand-new-pass-1')).status).toBe(200);
  });

  test('forgot-password never reveals whether the account exists', async () => {
    const { POST: forgot } = await import('@/app/api/auth/forgot-password/route');
    expect((await call(forgot, jsonReq('/api/auth/forgot-password', { identifier: 'ghost@example.com' }))).status).toBe(200);
  });

  test('tokens expire: verify after 24h, reset after 30min', async () => {
    const { issueToken, consumeToken } = await import('@/lib/auth/tokens');
    const [u] = await db.select().from(users).where(eq(users.email, 'a@example.com'));
    const t1 = await issueToken(u.id, 'reset', new Date(Date.now() - 31 * 60 * 1000));
    expect(await consumeToken(t1, 'reset')).toBeNull();
    const t2 = await issueToken(u.id, 'verify', new Date(Date.now() - 23 * 3600 * 1000));
    expect(await consumeToken(t2, 'verify')).toBe(u.id);
    const t3 = await issueToken(u.id, 'verify', new Date(Date.now() - 25 * 3600 * 1000));
    expect(await consumeToken(t3, 'verify')).toBeNull();
  });
});
