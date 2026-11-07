import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { TwoFactorClient } from './two-factor-client';

export const dynamic = 'force-dynamic';

/** Admin second step: enrol an authenticator (first time) or enter the 6-digit code / a recovery code. */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');
  if (session.role !== 'admin') redirect('/');
  if (session.mustChangePassword) redirect('/change-password');
  const next = (await searchParams).next;
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/admin';
  if (session.totpEnabled && session.mfaVerifiedAt) redirect(dest);
  return <TwoFactorClient enrolled={session.totpEnabled} next={dest} />;
}
