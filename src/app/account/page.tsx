import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AccountClient } from './account-client';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/account');
  return <AccountClient name={session.name} email={session.email} role={session.role} />;
}
