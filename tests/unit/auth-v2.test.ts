import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { call, jsonReq, loginAs } from '../helpers/http';
import { resetRequestContext } from '../helpers/next-headers';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { base32Decode, base32Encode, generateRecoveryCodes, hashRecoveryCode, hotp, totpAt, verifyTotp } from '@/lib/auth/totp';
import { encryptBytes } from '@/lib/storage/files';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
let inviteCode: string;
const PW = 'correct-horse-9';
let ipN = 0;
const ip = () => ({ 'x-forwarded-for': `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}` });

beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  db = await useTestDb();
  const soc = await makeSociety(db, { inviteCode: 'V2CODE' });
  societyId = soc.id;
  inviteCode = soc.inviteCode!;
});
beforeEach(() => resetRequestContext());

const reg = async (over: Record<string, unknown> = {}) => {
  const { POST } = await import('@/app/api/auth/register/route');
  const n = ++ipN;
  return call(POST, jsonReq('/api/auth/register', { phone: `9${String(800000000 + n).padStart(9, '0')}`, email: `v2u${n}@example.com`, name: 'V', password: PW, inviteCode, age18: true, acceptTerms: true, tower: 'B', flat: '202', ...over }, { headers: ip() }));
};
const loginReq = async (identifier: string, password = PW) => {
  const { POST } = await import('@/app/api/auth/login/route');
  return call(POST, jsonReq('/api/auth/login', { identifier, password }, { headers: ip() }));
};

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  const secret = Buffer.from('12345678901234567890');
  test('HOTP test vectors from RFC 4226', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, i) => expect(hotp(secret, i)).toBe(code));
  });
  test('TOTP test vectors from RFC 6238 (SHA-1, 8 digits → last 6)', () => {
    const b32 = base32Encode(secret);
    expect(totpAt(b32, 59_000, 30, 8)).toBe('94287082');
    expect(totpAt(b32, 1111111109_000, 30, 8)).toBe('07081804');
    expect(totpAt(b32, 20000000000_000, 30, 8)).toBe('65353130');
  });
  test('base32 round-trips; verification accepts ±1 step only and rejects junk', () => {
    const b32 = base32Encode(secret);
    expect(base32Decode(b32).equals(secret)).toBe(true);
    const now = 1_700_000_000_000;
    const code = totpAt(b32, now);
    expect(verifyTotp(b32, code, now)).toBe(true);
    expect(verifyTotp(b32, code, now + 30_000)).toBe(true);
    expect(verifyTotp(b32, code, now + 90_000)).toBe(false);
    expect(verifyTotp(b32, '000000', now)).toBe(false);
    expect(verifyTotp(b32, '12345', now)).toBe(false);
    expect(verifyTotp(b32, 'abcdef', now)).toBe(false);
  });
  test('10 distinct recovery codes, stored hashed', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((c) => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c))).toBe(true);
    expect(hashRecoveryCode(codes[0].toUpperCase())).toBe(hashRecoveryCode(codes[0]));
  });
});

describe('admin two-factor', () => {
  async function adminUser() {
    process.env.ADMIN_EMAILS = 'founder@example.com';
    const [u] = await db.insert(s.users).values({ phone: '9000000001', email: 'founder@example.com', emailVerifiedAt: new Date(), name: 'F', passwordHash: 'x', role: 'admin' }).onConflictDoNothing().returning();
    if (u) return u;
    return (await db.select().from(s.users).where(eq(s.users.email, 'founder@example.com')))[0];
  }
  const post = async (path: string, body: unknown) => {
    const mods = { setup: () => import('@/app/api/auth/2fa/setup/route'), enable: () => import('@/app/api/auth/2fa/enable/route'), verify: () => import('@/app/api/auth/2fa/verify/route') } as const;
    const mod = await mods[path as keyof typeof mods]();
    return call(mod.POST, jsonReq(`/api/auth/2fa/${path}`, body));
  };

  test('enrol → code check → 10 recovery codes shown once; the session becomes MFA-verified', async () => {
    const admin = await adminUser();
    await loginAs(admin.id, { mfa: false });
    const { requireSession } = await import('@/lib/auth');
    await expect(requireSession(['admin'])).rejects.toMatchObject({ status: 403, code: 'mfa_enroll' });
    const setup = await post('setup', {});
    expect(setup.status).toBe(200);
    const secret = setup.json.secret as string;
    expect(String(setup.json.qrSvg)).toContain('<svg');
    // the secret is stored encrypted, never as plain text
    const [stored] = await db.select().from(s.users).where(eq(s.users.id, admin.id));
    expect(stored.totpSecretEnc).toBeTruthy();
    expect(stored.totpSecretEnc).not.toContain(secret);
    expect((await post('enable', { code: '000000' })).status).toBe(400);
    const ok = await post('enable', { code: totpAt(secret, Date.now()) });
    expect(ok.status).toBe(200);
    expect((ok.json.recoveryCodes as string[]).length).toBe(10);
    const [after] = await db.select().from(s.users).where(eq(s.users.id, admin.id));
    expect(after.totpEnabledAt).toBeTruthy();
    expect(JSON.stringify(after.totpRecoveryHashesJson)).not.toContain((ok.json.recoveryCodes as string[])[0]);
    await expect(requireSession(['admin'])).resolves.toMatchObject({ role: 'admin' });
    expect((await post('setup', {})).status).toBe(409); // cannot re-enrol over an active secret
  });

  test('a fresh login must pass TOTP (or a single-use recovery code) before any admin API works', async () => {
    const admin = await adminUser();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, admin.id));
    const secret = (await import('@/lib/storage/files')).decryptBytes(Buffer.from(u.totpSecretEnc!, 'base64')).toString();
    const recovery = generateRecoveryCodes(2);
    await db.update(s.users).set({ totpRecoveryHashesJson: recovery.map(hashRecoveryCode) }).where(eq(s.users.id, admin.id));
    await loginAs(admin.id, { mfa: false });
    const { requireSession } = await import('@/lib/auth');
    await expect(requireSession(['admin'])).rejects.toMatchObject({ status: 403, code: 'mfa_required' });
    expect((await post('verify', { code: '123456' })).status).toBe(401);
    expect((await post('verify', { code: totpAt(secret, Date.now()) })).status).toBe(200);
    await expect(requireSession(['admin'])).resolves.toBeDefined();
    // recovery code works once
    await loginAs(admin.id, { mfa: false });
    expect((await post('verify', { code: recovery[0] })).status).toBe(200);
    await loginAs(admin.id, { mfa: false });
    expect((await post('verify', { code: recovery[0] })).status).toBe(401);
    expect((await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'auth.recovery_code_used'))).length).toBe(1);
  });

  test('the admin session is 12 hours and does not slide; sensitive actions need a TOTP check in the last 10 minutes', async () => {
    const admin = await adminUser();
    await loginAs(admin.id);
    const [sess] = await db.select().from(s.sessions).where(eq(s.sessions.userId, admin.id));
    const hours = (sess.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    const { requireRecentMfa, requireSession } = await import('@/lib/auth');
    const session = await requireSession(['admin']);
    expect(() => requireRecentMfa(session)).not.toThrow();
    expect(() => requireRecentMfa(session, new Date(Date.now() + 11 * 60_000))).toThrowError(/authenticator/);
    // the settings route enforces it
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(s.sessions.userId, admin.id));
    const { PATCH } = await import('@/app/api/admin/settings/route');
    const r = await call(PATCH, jsonReq('/api/admin/settings', { buyerPlatformFeeBps: 900, reason: 'test change' }, { method: 'PATCH' }));
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('reauth_required');
    const [u] = await db.select().from(s.users).where(eq(s.users.id, admin.id));
    const secret = (await import('@/lib/storage/files')).decryptBytes(Buffer.from(u.totpSecretEnc!, 'base64')).toString();
    const reauth = await import('@/app/api/auth/2fa/reauth/route');
    expect((await call(reauth.POST, jsonReq('/api/auth/2fa/reauth', { code: totpAt(secret, Date.now()) }))).status).toBe(200);
    expect((await call(PATCH, jsonReq('/api/admin/settings', { buyerPlatformFeeBps: 1000, reason: 'test change' }, { method: 'PATCH' }))).status).toBe(200);
  });

  test('login response tells an admin they still need 2FA; a normal user is unaffected', async () => {
    const r = await reg();
    expect(r.status).toBe(200);
    const u = (await db.select().from(s.users).orderBy(s.users.id)).pop()!;
    expect((await loginReq(u.email!)).json.mfa).toBeNull();
  });
});

/** Walks src/app/api/admin/** and every route that gates on admin: each handler must refuse an admin session without 2FA. */
describe('route scan: no admin route works without a 2FA-verified session', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name === 'route.ts') out.push(p);
    }
    return out;
  }
  const root = path.join(process.cwd(), 'src/app/api');
  const routes = walk(root).filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return f.includes(`${path.sep}admin${path.sep}`) || /requireSession\(\[\s*'admin'\s*\]/.test(src);
  });

  test('found a meaningful number of admin routes', () => expect(routes.length).toBeGreaterThan(25));

  test.each(routes.map((f) => [path.relative(root, f), f]))('%s', async (_rel, file) => {
    const admin = await makeUser(db, 'admin');
    process.env.ADMIN_EMAILS = admin.email!;
    await loginAs(admin.id, { mfa: false });
    const mod = await import(/* @vite-ignore */ file as string);
    const methods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].filter((m) => typeof mod[m] === 'function');
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) {
      const req = jsonReq('/api/x', m === 'GET' ? undefined : {}, { method: m });
      const res = await call(mod[m], req, { id: '1', userId: '1', key: 'x' });
      // The auth routes that ARE the 2FA flow legitimately accept a not-yet-verified admin.
      if (/auth\/2fa\/(setup|enable|verify)\//.test(file.replaceAll(path.sep, '/') + '/')) continue;
      expect(res.status, `${m} ${_rel}`).toBe(403);
      expect(['mfa_required', 'mfa_enroll'], `${m} ${_rel} must refuse because of 2FA`).toContain(res.json.code as string);
    }
  });

  test('and with a verified session the same gate lets the admin through (the scan is not vacuous)', async () => {
    const admin = await makeUser(db, 'admin');
    process.env.ADMIN_EMAILS = admin.email!;
    await loginAs(admin.id, { mfa: true });
    const { GET } = await import('@/app/api/admin/summary/route');
    expect((await call(GET, jsonReq('/api/admin/summary', undefined, { method: 'GET' }))).status).toBe(200);
  });
});

describe('account security', () => {
  test('lockout after 10 failures in the window, with exponential back-off; success resets; the lock does not reveal unknown accounts', async () => {
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('loginLockMaxFailures', '4'); // the production default is 10 in 15 minutes
    await reg();
    const u = (await db.select().from(s.users).orderBy(s.users.id)).pop()!;
    for (let i = 0; i < 3; i++) expect((await loginReq(u.email!, 'wrong-password-1')).status).toBe(401);
    expect((await loginReq(u.email!)).status).toBe(200); // a good login before the limit resets the counter
    expect((await db.select().from(s.users).where(eq(s.users.id, u.id)))[0].failedLoginCount).toBe(0);
    for (let i = 0; i < 3; i++) await loginReq(u.email!, 'wrong-password-1');
    const tenth = await loginReq(u.email!, 'wrong-password-1');
    expect(tenth.status).toBe(429);
    expect(tenth.json.code).toBe('locked');
    const locked = (await db.select().from(s.users).where(eq(s.users.id, u.id)))[0].lockedUntil!;
    expect(locked.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    // even the right password is refused while locked
    expect((await loginReq(u.email!)).status).toBe(429);
    // further failures double the lock
    await db.update(s.users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(s.users.id, u.id));
    const again = await loginReq(u.email!, 'wrong-password-1');
    expect(again.status).toBe(429);
    const second = (await db.select().from(s.users).where(eq(s.users.id, u.id)))[0].lockedUntil!;
    expect(second.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    // an unknown address just gets the generic 401
    expect((await loginReq('nobody-here@example.com', 'x')).status).toBe(401);
    await setPlatformSetting('loginLockMaxFailures', '10');
  });

  test('email code login: 6 digits, hashed at rest, single use, 5 attempts, 10-minute expiry, no account enumeration', async () => {
    await reg();
    const u = (await db.select().from(s.users).orderBy(s.users.id)).pop()!;
    const { POST: request } = await import('@/app/api/auth/login-code/request/route');
    const { POST: verify } = await import('@/app/api/auth/login-code/verify/route');
    const known = await call(request, jsonReq('/api/auth/login-code/request', { email: u.email }, { headers: ip() }));
    const unknown = await call(request, jsonReq('/api/auth/login-code/request', { email: 'ghost@example.com' }, { headers: ip() }));
    expect(known.json).toEqual(unknown.json); // identical answer
    expect(known.status).toBe(unknown.status);
    const mail = (await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toEmail, u.email!))).filter((m) => m.kind === 'login_code').pop()!;
    const code = mail.bodyText.match(/code is (\d{6})/)![1];
    const [row] = await db.select().from(s.loginCodes).where(eq(s.loginCodes.email, u.email!));
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toEmail, 'ghost@example.com'))).length).toBe(0);
    const v = (c: string) => call(verify, jsonReq('/api/auth/login-code/verify', { email: u.email, code: c }, { headers: ip() }));
    expect((await v('000000')).status).toBe(401);
    expect((await v(code)).status).toBe(200);
    expect((await v(code)).status).toBe(401); // single use
    // attempts cap: 5 wrong guesses burn the code even if the 6th is right
    await call(request, jsonReq('/api/auth/login-code/request', { email: u.email }, { headers: ip() }));
    const m2 = (await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toEmail, u.email!))).filter((m) => m.kind === 'login_code').pop()!;
    const code2 = m2.bodyText.match(/code is (\d{6})/)![1];
    const wrong = code2 === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) await v(wrong);
    expect((await v(code2)).status).toBe(401);
    // expiry
    const { issueLoginCode, consumeLoginCode } = await import('@/lib/auth/login-code');
    await issueLoginCode(u.email!, new Date(Date.now() - 11 * 60_000));
    const m3 = (await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.toEmail, u.email!))).filter((m) => m.kind === 'login_code').pop()!;
    await expect(consumeLoginCode(u.email!, m3.bodyText.match(/code is (\d{6})/)![1])).rejects.toMatchObject({ status: 401 });
  });

  test('a new device triggers an email alert; the first login and a known device do not', async () => {
    await reg();
    const u = (await db.select().from(s.users).orderBy(s.users.id)).pop()!;
    const { noteLoginAndAlert } = await import('@/lib/auth/device');
    expect(await noteLoginAndAlert(u.id, 'Chrome/1', '1.1.1.1')).toBe(false); // first ever
    expect(await noteLoginAndAlert(u.id, 'Chrome/1', '1.1.1.2')).toBe(false); // same device
    expect(await noteLoginAndAlert(u.id, 'Firefox/9', '2.2.2.2')).toBe(true); // new device
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, u.id))).some((m) => m.kind === 'new_device_login')).toBe(true);
  });

  test('password change alerts the user and signs out the other devices; sessions can be listed and revoked individually', async () => {
    await reg();
    const u = (await db.select().from(s.users).orderBy(s.users.id)).pop()!;
    await loginReq(u.email!);
    await loginReq(u.email!);
    const { GET, DELETE } = await import('@/app/api/auth/sessions/route');
    await loginAs(u.id);
    const list = await call(GET as never, jsonReq('/api/auth/sessions', undefined, { method: 'GET' }));
    const sessions = list.json.sessions as { key: string; current: boolean }[];
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(list.json)).not.toMatch(/"id"/); // raw session ids never leave the server
    const other = sessions.find((x) => !x.current)!;
    expect((await call(DELETE, jsonReq('/api/auth/sessions', { key: other.key }, { method: 'DELETE' }))).status).toBe(200);
    expect((await call(DELETE, jsonReq('/api/auth/sessions', { key: 'nope' }, { method: 'DELETE' }))).status).toBe(404);
    const { POST: change } = await import('@/app/api/auth/change-password/route');
    expect((await call(change, jsonReq('/api/auth/change-password', { current: PW, next: 'another-fine-pass-77' }))).status).toBe(200);
    expect((await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, u.id))).some((m) => m.kind === 'security_alert' && /password was changed/.test(m.bodyText))).toBe(true);
  });
});

describe('registration: consent, age gate, invite-only, membership', () => {
  test('under-18 and missing consent are refused; no pre-ticked defaults', async () => {
    expect((await reg({ age18: false })).status).toBe(400);
    expect((await reg({ age18: undefined })).status).toBe(400);
    expect((await reg({ acceptTerms: false })).status).toBe(400);
    expect((await reg({ acceptTerms: 'yes' })).status).toBe(400);
  });

  test('consent versions and timestamps are stored; membership is created with tower/flat and auto-approved via invite', async () => {
    const r = await reg();
    expect(r.status).toBe(200);
    expect(r.json.pending).toBe(false);
    const u = (await db.select().from(s.users).orderBy(s.users.id)).pop()!;
    const c = await db.select().from(s.consents).where(eq(s.consents.userId, u.id));
    expect(c.map((x) => `${x.kind}:${x.version}`).sort()).toEqual(['age18:1', 'privacy:2026-11-draft1', 'terms:2026-11-draft1']);
    expect(c.every((x) => x.acceptedAt instanceof Date)).toBe(true);
    const [m] = await db.select().from(s.societyMemberships).where(eq(s.societyMemberships.userId, u.id));
    expect(m).toMatchObject({ societyId, tower: 'B', flat: '202', status: 'approved' });
    expect(u.age18ConfirmedAt).toBeTruthy();
  });

  test('a society on manual approval holds the resident as pending until an admin approves them', async () => {
    const manual = await makeSociety(db, { requireApproval: true, inviteCode: 'MANUAL1' });
    const r = await reg({ inviteCode: 'MANUAL1' });
    expect(r.json.pending).toBe(true);
    const u = (await db.select().from(s.users).orderBy(s.users.id)).pop()!;
    const k = await makeLiveKitchen(db, { societyId: manual.id });
    const { createHomeOrder } = await import('@/lib/orders/create');
    await expect(createHomeOrder({ buyerId: u.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 403 });
    const admin = await makeUser(db, 'admin');
    process.env.ADMIN_EMAILS = admin.email!;
    await loginAs(admin.id);
    const { POST } = await import('@/app/api/admin/memberships/route');
    const [m] = await db.select().from(s.societyMemberships).where(eq(s.societyMemberships.userId, u.id));
    expect((await call(POST, jsonReq('/api/admin/memberships', { membershipId: m.id, action: 'approve' }))).status).toBe(200);
    expect((await db.select().from(s.users).where(eq(s.users.id, u.id)))[0].approvalStatus).toBe('approved');
    // verified email is also required before the first order
    await db.update(s.users).set({ emailVerifiedAt: null }).where(eq(s.users.id, u.id));
    await expect(createHomeOrder({ buyerId: u.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/verify your email/) });
  });

  test('invite-only: no invite code, no account; the public society list is empty; non-members cannot browse', async () => {
    expect((await reg({ inviteCode: undefined, societyId })).status).toBe(400);
    expect((await reg({ inviteCode: 'NOPE-0000' })).status).toBe(400);
    const { GET: societies } = await import('@/app/api/societies/route');
    expect((await call(societies, jsonReq('/api/societies?live=1', undefined, { method: 'GET' }))).json.societies).toEqual([]);
    const { GET: listings } = await import('@/app/api/listings/route');
    resetRequestContext();
    const visitor = await call(listings, jsonReq('/api/listings', undefined, { method: 'GET' }));
    expect(visitor.status).toBe(403);
    expect(visitor.json.code).toBe('invite_only');
    const outsider = await makeUser(db, 'buyer'); // no society, no membership
    await loginAs(outsider.id);
    expect((await call(listings, jsonReq('/api/listings', undefined, { method: 'GET' }))).status).toBe(403);
    const member = await makeUser(db, 'buyer', { societyId });
    await loginAs(member.id);
    expect((await call(listings, jsonReq('/api/listings', undefined, { method: 'GET' }))).status).toBe(200);
  });

  test('the access-request form lands in the admin queue and notifies admins', async () => {
    const admin = await makeUser(db, 'admin');
    const { POST } = await import('@/app/api/access-requests/route');
    expect((await call(POST, jsonReq('/api/access-requests', { societyName: '' }, { headers: ip() }))).status).toBe(400);
    const r = await call(POST, jsonReq('/api/access-requests', { societyName: 'Green Meadows', contactName: 'Ravi', email: 'ravi@example.com' }, { headers: ip() }));
    expect(r.status).toBe(200);
    expect((await db.select().from(s.societyAccessRequests))[0]).toMatchObject({ societyName: 'Green Meadows', status: 'open' });
    expect((await db.select().from(s.notifications).where(eq(s.notifications.userId, admin.id))).some((n) => n.title === 'New society access request')).toBe(true);
  });

  test('ranking: own society first, then distance → rating → recency', async () => {
    const other = await makeSociety(db, { lat: 17.5, lng: 78.35 });
    const own = await makeLiveKitchen(db, { societyId });
    const far = await makeLiveKitchen(db, { societyId: other.id });
    await db.update(s.users).set({ lat: 17.465, lng: 78.31 }).where(eq(s.users.id, own.seller.id));
    await db.update(s.users).set({ lat: 17.47, lng: 78.31 }).where(eq(s.users.id, far.seller.id));
    await db.update(s.sellerProfiles).set({ rating: 3.1 }).where(eq(s.sellerProfiles.userId, own.seller.id));
    await db.update(s.sellerProfiles).set({ rating: 4.9 }).where(eq(s.sellerProfiles.userId, far.seller.id));
    const { browseListings } = await import('@/lib/browse');
    const res = await browseListings({ lat: 17.465, lng: 78.31, homeSocietyId: societyId });
    const order = res.listings.map((l) => l.sellerId);
    expect(order.indexOf(own.seller.id)).toBeLessThan(order.indexOf(far.seller.id)); // own society beats a better-rated neighbour
    const plain = await browseListings({ lat: 17.465, lng: 78.31 });
    expect(plain.listings.map((l) => l.sellerId).indexOf(own.seller.id)).toBeLessThan(plain.listings.map((l) => l.sellerId).indexOf(far.seller.id)); // closer wins
  });
});

describe('account export and deletion (DPDP)', () => {
  test('export contains the user’s data but never password hashes, 2FA secrets or PAN ciphertext', async () => {
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ panEnc: encryptBytes(Buffer.from('ABCDE1234F')).toString('base64'), panMasked: 'ABCDE****F', legalName: 'Kamala Devi' }).where(eq(s.sellerProfiles.userId, k.seller.id));
    await loginAs(k.seller.id);
    const { GET } = await import('@/app/api/account/export/route');
    const res = await GET(jsonReq('/api/account/export', undefined, { method: 'GET' }) as never, { params: {} } as never);
    const text = await res.text();
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const data = JSON.parse(text);
    expect(data.account.email).toBe(k.seller.email);
    expect(data.sellerProfile.panMasked).toBe('ABCDE****F');
    expect(text).not.toMatch(/passwordHash|password_hash|totpSecret|panEnc/);
    expect(text).not.toContain('ABCDE1234F');
    expect(data.listings).toHaveLength(1);
  });

  test('deletion is blocked while an order is open, then anonymises personal data and keeps the order record', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const k = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    await db.update(s.users).set({ passwordHash: await (await import('@/lib/auth')).hashPassword(PW) }).where(eq(s.users.id, buyer.id));
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    await db.update(s.orders).set({ deliveryAddressJson: { label: 'Home', flat: 'C-9', societyName: 'S', addressText: 'x', lat: 17.465, lng: 78.31 } }).where(eq(s.orders.buyerId, buyer.id));
    await markOrderPaid(r.orderId, { razorpayPaymentId: 'pay_del' });
    await loginAs(buyer.id);
    const { POST } = await import('@/app/api/account/delete/route');
    expect((await call(POST, jsonReq('/api/account/delete', { password: 'wrong', confirm: 'DELETE' }))).status).toBe(400);
    expect((await call(POST, jsonReq('/api/account/delete', { password: PW, confirm: 'nope' }))).status).toBe(400);
    const blocked = await call(POST, jsonReq('/api/account/delete', { password: PW, confirm: 'DELETE' }));
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatch(/open order/);
    const { performOrderAction } = await import('@/lib/orders/actions');
    await performOrderAction(r.orderId, { action: 'buyer_cancel', actor: 'buyer', actorId: buyer.id });
    await loginAs(buyer.id);
    expect((await call(POST, jsonReq('/api/account/delete', { password: PW, confirm: 'DELETE' }))).status).toBe(200);
    const [u] = await db.select().from(s.users).where(eq(s.users.id, buyer.id));
    expect(u).toMatchObject({ name: 'Deleted user', email: null, societyId: null });
    expect(u.anonymizedAt).toBeTruthy();
    expect(u.phone).not.toBe(buyer.phone);
    expect(await db.select().from(s.sessions).where(eq(s.sessions.userId, buyer.id))).toHaveLength(0);
    expect(await db.select().from(s.societyMemberships).where(eq(s.societyMemberships.userId, buyer.id))).toHaveLength(0);
    const [o] = await db.select().from(s.orders).where(eq(s.orders.id, r.orderId));
    expect(o.deliveryAddressJson).toBeNull(); // personal field pseudonymised
    expect(o.foodTotalInPaise).toBeGreaterThan(0); // the tax record itself survives
    expect((await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'account.deleted'), eq(s.auditLog.actorId, buyer.id)))).length).toBe(1);
    // a deleted account cannot log back in, and cannot order
    expect((await loginReq(buyer.email!)).status).toBe(401);
    await expect(createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('Google sign-in adapter', () => {
  test('off unless configured; exchangeCode verifies the nonce and the token response', async () => {
    const g = await import('@/lib/auth/google');
    delete process.env.GOOGLE_CLIENT_ID;
    expect(g.googleEnabled()).toBe(false);
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'sec';
    expect(g.googleEnabled()).toBe(true);
    expect(g.authorizationUrl('https://x/cb', 'st', 'no')).toContain('state=st');
    const fakeFetch = (async () => new Response(JSON.stringify({ id_token: 'tok' }), { status: 200 })) as unknown as typeof fetch;
    const verify = (async () => ({ payload: { sub: 'sub1', email: 'A@B.com', email_verified: true, name: 'A', nonce: 'n1' } })) as never;
    await expect(g.exchangeCode('c', 'https://x/cb', 'n1', fakeFetch, verify)).resolves.toEqual({ sub: 'sub1', email: 'a@b.com', emailVerified: true, name: 'A' });
    await expect(g.exchangeCode('c', 'https://x/cb', 'WRONG', fakeFetch, verify)).rejects.toThrow();
    await expect(g.exchangeCode('c', 'https://x/cb', 'n1', (async () => new Response('no', { status: 400 })) as unknown as typeof fetch, verify)).rejects.toThrow();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
});
