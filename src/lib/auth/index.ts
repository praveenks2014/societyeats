import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { ApiError } from '@/lib/api';

/**
 * Lightweight phone+password auth with a JWT httpOnly cookie.
 * The module is structured so an OTP provider (e.g. MSG91) can replace
 * verifyPassword() later: swap the credential check in /api/auth/login and
 * keep createSessionCookie() unchanged.
 */

export type Role = 'buyer' | 'seller' | 'restaurant' | 'admin';

export type Session = {
  uid: number;
  role: Role;
  name: string;
  phone: string;
};

const COOKIE_NAME = 'gharse_session';
const SESSION_DAYS = 30;

function jwtSecret(): Uint8Array {
  // No dev fallback on purpose: startup env validation (src/instrumentation.ts)
  // already refuses to boot the server without JWT_SECRET, so reaching here
  // without one means that guard was bypassed — fail closed, not open.
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set — the app cannot sign or verify sessions');
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSessionCookie(session: Session): Promise<void> {
  const token = await new SignJWT(session as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(jwtSecret());
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: '/',
  });
}

export function clearSessionCookie(): void {
  cookies().set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    return {
      uid: payload.uid as number,
      role: payload.role as Role,
      name: payload.name as string,
      phone: payload.phone as string,
    };
  } catch {
    return null;
  }
}

export async function requireSession(roles?: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, 'Please log in');
  if (roles && !roles.includes(session.role)) {
    throw new ApiError(403, 'Not allowed for your account type');
  }
  return session;
}
