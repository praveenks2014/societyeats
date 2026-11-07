import crypto from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import * as React from 'react';
import { ApiError } from '@/lib/api';
import { BRAND } from '@/config/brand';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { sessions, users } from '@/lib/db/schema';
import { effectiveRole } from './admins';

export { hashPassword, verifyPassword } from './passwords';

/**
 * Phone/email + password auth with DB-backed sessions.
 *
 * The cookie holds a JWT with ONLY the session id (`sid`); it expires after 7
 * days and is re-issued as it is used (sliding). Role, blocked and
 * must-change-password state are read from the database on every request, so
 * demotion, blocking and logout take effect immediately.
 */

export type Role = 'buyer' | 'seller' | 'restaurant' | 'admin';

export type Session = {
  uid: number;
  sid: string;
  role: Role;
  name: string;
  phone: string;
  email: string | null;
  emailVerified: boolean;
  mustChangePassword: boolean;
  approvalStatus: 'approved' | 'pending' | 'rejected';
  societyId: number | null;
  /** Admin 2FA: enrolled, and has this session passed a TOTP / recovery-code check? */
  totpEnabled: boolean;
  mfaVerifiedAt: Date | null;
};

export const COOKIE_NAME = BRAND.cookieName;
export const SESSION_DAYS = 7;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

function jwtSecret(): Uint8Array {
  // No dev fallback on purpose: startup env validation (src/instrumentation.ts)
  // already refuses to boot the server without JWT_SECRET, so reaching here
  // without one means that guard was bypassed — fail closed, not open.
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set — the app cannot sign or verify sessions');
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(sid: string): Promise<string> {
  return new SignJWT({ sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(jwtSecret());
}

export async function verifySessionToken(token: string): Promise<{ sid: string; iat: number } | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    if (typeof payload.sid !== 'string') return null;
    return { sid: payload.sid, iat: Number(payload.iat ?? 0) };
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: '/',
  };
}

export const deviceHashOf = (ua: string | null) => crypto.createHash('sha256').update(ua ?? 'unknown').digest('hex').slice(0, 32);

/** Creates a session row and sets the cookie. Admin sessions are short (adminSessionHours) and need 2FA before the admin area opens. */
export async function createSession(userId: number, opts: { mfaVerified?: boolean } = {}): Promise<string> {
  const db = await getDb();
  const sid = crypto.randomBytes(24).toString('hex');
  let ua: string | null = null;
  let ip: string | null = null;
  try {
    const h = await headers();
    ua = h.get('user-agent')?.slice(0, 200) ?? null;
    ip = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) ?? null;
  } catch {
    ua = null;
  }
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const isAdmin = !!u && effectiveRole(u) === 'admin';
  const ttlMs = isAdmin ? (await getPlatformSettings()).adminSessionHours * 60 * 60 * 1000 : SESSION_DAYS * 24 * 60 * 60 * 1000;
  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt: new Date(Date.now() + ttlMs),
    userAgent: ua,
    ip,
    deviceHash: deviceHashOf(ua),
    mfaVerifiedAt: opts.mfaVerified ? new Date() : null,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  (await cookies()).set(COOKIE_NAME, await signSessionToken(sid), { ...cookieOptions(), ...(isAdmin ? { maxAge: Math.floor(ttlMs / 1000) } : {}) });
  return sid;
}

export async function destroyCurrentSession(): Promise<void> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const parsed = token ? await verifySessionToken(token) : null;
  if (parsed) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, parsed.sid));
  }
  (await cookies()).set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
}

export async function revokeAllSessions(userId: number): Promise<void> {
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Pure DB resolution of a session id → Session (or null). Rejects expired
 * sessions and blocked users; the role is computed from the user row + the
 * ADMIN_EMAILS allowlist, never from the token.
 */
export async function resolveSession(sid: string): Promise<Session | null> {
  const db = await getDb();
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())));
  if (!row || row.u.blockedAt) return null;
  const u = row.u;
  const role = effectiveRole(u);
  // Sliding expiry in the DB (throttled to one write an hour). Admin sessions never slide: they end at the fixed admin session length.
  if (role !== 'admin' && Date.now() - row.s.lastSeenAt.getTime() > 60 * 60 * 1000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000) })
      .where(eq(sessions.id, sid));
  }
  return {
    uid: u.id,
    sid,
    role,
    name: u.name,
    phone: u.phone,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    mustChangePassword: u.mustChangePassword,
    approvalStatus: (u.approvalStatus as Session['approvalStatus']) ?? 'approved',
    societyId: u.societyId,
    totpEnabled: !!u.totpEnabledAt,
    mfaVerifiedAt: row.s.mfaVerifiedAt,
  };
}

// React's per-request memoisation (only present in the server build of React);
// a pass-through elsewhere (unit tests, scripts).
const requestCache: <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => (...a: A) => Promise<R> =
  (React as unknown as { cache?: never }).cache ?? ((fn) => fn);

const sessionForToken = requestCache(async (token: string): Promise<Session | null> => {
  const parsed = await verifySessionToken(token);
  if (!parsed) return null;
  const session = await resolveSession(parsed.sid);
  if (!session) return null;
  // Sliding renewal of the cookie. Setting cookies only works in route
  // handlers/actions, so this is a best-effort no-op while rendering pages
  // (the proxy also renews — see src/proxy.ts).
  if (Date.now() / 1000 - parsed.iat > RENEW_AFTER_MS / 1000) {
    try {
      (await cookies()).set(COOKIE_NAME, await signSessionToken(parsed.sid), cookieOptions());
    } catch {
      /* read-only context */
    }
  }
  return session;
});

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  return sessionForToken(token);
}

export async function requireSession(roles?: Role[], opts: { allowMustChange?: boolean; allowMfaPending?: boolean } = {}): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, 'Please log in');
  if (session.mustChangePassword && !opts.allowMustChange) {
    throw new ApiError(403, 'Please change your password first');
  }
  if (roles && !roles.includes(session.role)) {
    throw new ApiError(403, 'Not allowed for your account type');
  }
  // Admin 2FA is mandatory: no /admin page or /api/admin route works on a session that has not passed TOTP.
  if (session.role === 'admin' && !opts.allowMfaPending) {
    if (!session.totpEnabled) throw new ApiError(403, 'Set up two-factor authentication to use the admin area', 'mfa_enroll');
    if (!session.mfaVerifiedAt) throw new ApiError(403, 'Enter your two-factor code to continue', 'mfa_required');
  }
  return session;
}

/** Sensitive admin actions (settings, refunds, delisting, reading a reported chat, exports) need a TOTP check in the last 10 minutes. */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
export function requireRecentMfa(session: Session, now: Date = new Date()): void {
  if (session.role !== 'admin') return;
  if (!session.mfaVerifiedAt || now.getTime() - session.mfaVerifiedAt.getTime() > REAUTH_WINDOW_MS) {
    throw new ApiError(403, 'Please confirm with your authenticator code to do this', 'reauth_required');
  }
}

export async function markSessionMfaVerified(sid: string): Promise<void> {
  const db = await getDb();
  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, sid));
}

/** Public, non-secret handle for a session (the raw session id never leaves the server). */
export const sessionKey = (sid: string) => crypto.createHash('sha256').update(`sess:${sid}`).digest('hex').slice(0, 16);

export async function listSessions(userId: number) {
  const db = await getDb();
  const rows = await db.select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, userAgent: sessions.userAgent, ip: sessions.ip }).from(sessions).where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return rows.map((r) => ({ ...r, key: sessionKey(r.id) }));
}

export async function revokeSession(userId: number, key: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  const hit = rows.find((r) => sessionKey(r.id) === key);
  if (!hit) return false;
  await db.delete(sessions).where(eq(sessions.id, hit.id));
  return true;
}
