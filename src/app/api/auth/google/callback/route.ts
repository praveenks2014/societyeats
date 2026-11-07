import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import { effectiveRole, promoteIfAllowlisted } from '@/lib/auth/admins';
import { sendSecurityAlert, noteLoginAndAlert } from '@/lib/auth/device';
import { exchangeCode, googleEnabled } from '@/lib/auth/google';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { clientIp } from '@/lib/rate-limit';
import { siteOrigin } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
  if (!googleEnabled()) return fail('google_off');
  const raw = req.cookies.get('pp_google')?.value;
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  let saved: { state: string; nonce: string; link: number | null };
  try {
    saved = JSON.parse(raw ?? '');
  } catch {
    return fail('google_failed');
  }
  if (!code || !state || state !== saved.state) return fail('google_failed');
  let g;
  try {
    g = await exchangeCode(code, `${await siteOrigin()}/api/auth/google/callback`, saved.nonce);
  } catch {
    return fail('google_failed');
  }
  if (!g.emailVerified) return fail('google_unverified');
  const db = await getDb();
  const clear = (res: NextResponse) => {
    res.cookies.delete('pp_google');
    return res;
  };

  // Linking from an already signed-in session.
  if (saved.link) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.googleSub, g.sub));
    if (taken && taken.id !== saved.link) return clear(NextResponse.redirect(new URL('/account?error=google_taken', req.url)));
    await db.update(users).set({ googleSub: g.sub }).where(eq(users.id, saved.link));
    await sendSecurityAlert(saved.link, 'Google sign-in was linked to your account');
    return clear(NextResponse.redirect(new URL('/account?linked=google', req.url)));
  }

  const [bySub] = await db.select().from(users).where(eq(users.googleSub, g.sub));
  if (!bySub) {
    const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, g.email));
    // Never auto-link an existing e-mail: sign in the usual way first, then link Google from the account page.
    return fail(byEmail ? 'google_link_first' : 'google_no_account');
  }
  if (bySub.blockedAt || bySub.anonymizedAt) return fail('google_failed');
  await promoteIfAllowlisted(db, bySub.id);
  await createSession(bySub.id);
  await noteLoginAndAlert(bySub.id, req.headers.get('user-agent'), clientIp(req));
  const role = effectiveRole(bySub);
  return clear(NextResponse.redirect(new URL(role === 'admin' ? '/auth/2fa?next=/admin' : '/', req.url)));
}
