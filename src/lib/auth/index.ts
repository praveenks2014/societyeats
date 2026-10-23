import crypto from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import * as React from 'react';
import { ApiError } from '@/lib/api';
import { BRAND } from '@/config/brand';
import { getDb } from '@/lib/db';
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

/** Creates a session row and sets the cookie. */
export async function createSession(userId: number): Promise<string> {
  const db = await getDb();
  const sid = crypto.randomBytes(24).toString('hex');
  let ua: string | null = null;
  try {
    ua = headers().get('user-agent')?.slice(0, 200) ?? null;
  } catch {
    ua = null;
  }
  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    userAgent: ua,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  cookies().set(COOKIE_NAME, await signSessionToken(sid), cookieOptions());
  return sid;
}

export async function destroyCurrentSession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value;
  const parsed = token ? await verifySessionToken(token) : null;
  if (parsed) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, parsed.sid));
  }
  cookies().set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
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
  // Sliding expiry in the DB (throttled to one write an hour).
  if (Date.now() - row.s.lastSeenAt.getTime() > 60 * 60 * 1000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000) })
      .where(eq(sessions.id, sid));
  }
  return {
    uid: u.id,
    sid,
    role: effectiveRole(u),
    name: u.name,
    phone: u.phone,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    mustChangePassword: u.mustChangePassword,
    approvalStatus: (u.approvalStatus as Session['approvalStatus']) ?? 'approved',
    societyId: u.societyId,
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
  // (middleware also renews — see src/middleware.ts).
  if (Date.now() / 1000 - parsed.iat > RENEW_AFTER_MS / 1000) {
    try {
      cookies().set(COOKIE_NAME, await signSessionToken(parsed.sid), cookieOptions());
    } catch {
      /* read-only context */
    }
  }
  return session;
});

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  return sessionForToken(token);
}

export async function requireSession(roles?: Role[], opts: { allowMustChange?: boolean } = {}): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, 'Please log in');
  if (session.mustChangePassword && !opts.allowMustChange) {
    throw new ApiError(403, 'Please change your password first');
  }
  if (roles && !roles.includes(session.role)) {
    throw new ApiError(403, 'Not allowed for your account type');
  }
  return session;
}
