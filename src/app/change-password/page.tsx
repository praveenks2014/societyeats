import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ChangePasswordForm } from './form';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/change-password');
  return <ChangePasswordForm forced={session.mustChangePassword} />;
}
