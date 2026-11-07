import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { authorizationUrl, googleEnabled, newState } from '@/lib/auth/google';
import { siteOrigin } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

/** `?link=1` (signed-in users) links Google to the current account instead of signing in. */
export async function GET(req: NextRequest) {
  if (!googleEnabled()) return NextResponse.redirect(new URL('/login?error=google_off', req.url));
  const state = newState();
  const nonce = newState();
  const session = req.nextUrl.searchParams.get('link') ? await getSession() : null;
  const redirectUri = `${await siteOrigin()}/api/auth/google/callback`;
  const res = NextResponse.redirect(authorizationUrl(redirectUri, state, nonce));
  res.cookies.set('pp_google', JSON.stringify({ state, nonce, link: session?.uid ?? null }), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600, path: '/' });
  return res;
}
