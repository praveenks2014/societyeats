import { jwtVerify, SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Two jobs, both cheap and DB-free (edge runtime):
 *  1. CSRF: a state-changing /api request whose Origin header names a
 *     different host is rejected. Browsers always send Origin on cross-site
 *     POSTs; non-browser clients (no Origin) carry no ambient cookie to abuse.
 *     Webhooks and the cron endpoint are exempt (they authenticate by secret).
 *  2. Sliding session renewal: a validly-signed session cookie older than a
 *     day is re-issued with a fresh 7-day expiry. (The DB session row is the
 *     source of truth and is checked in getSession(); this only keeps the
 *     cookie alive.)
 */
const COOKIE = 'padosi_session';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT = [/^\/api\/webhooks\//, /^\/api\/cron\//];

function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | null | undefined) => h && hosts.add(h.toLowerCase());
  add(req.headers.get('host'));
  add(req.headers.get('x-forwarded-host'));
  try {
    if (process.env.SITE_URL) add(new URL(process.env.SITE_URL).host);
  } catch {
    /* ignore */
  }
  return hosts;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/') && MUTATING.has(req.method) && !CSRF_EXEMPT.some((r) => r.test(pathname))) {
    const origin = req.headers.get('origin');
    if (origin) {
      let host = '';
      try {
        host = new URL(origin).host.toLowerCase();
      } catch {
        /* malformed → reject below */
      }
      if (!host || !allowedHosts(req).has(host)) {
        return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 });
      }
    }
  }

  const res = NextResponse.next();
  const token = req.cookies.get(COOKIE)?.value;
  const secret = process.env.JWT_SECRET;
  if (token && secret && !pathname.startsWith('/_next')) {
    try {
      const key = new TextEncoder().encode(secret);
      const { payload } = await jwtVerify(token, key);
      const age = Date.now() / 1000 - Number(payload.iat ?? 0);
      if (age > 24 * 60 * 60 && typeof payload.sid === 'string') {
        const fresh = await new SignJWT({ sid: payload.sid }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(key);
        res.cookies.set(COOKIE, fresh, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 7 * 24 * 60 * 60,
          path: '/',
        });
      }
    } catch {
      /* invalid/expired token: getSession() will treat it as logged out */
    }
  }
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|manifest|sw.js).*)'] };
