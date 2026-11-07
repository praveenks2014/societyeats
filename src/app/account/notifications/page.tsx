import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { NotificationPrefsForm } from './prefs-form';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/account/notifications');
  if (session.role === 'admin') redirect('/admin');
  return <NotificationPrefsForm />;
}
