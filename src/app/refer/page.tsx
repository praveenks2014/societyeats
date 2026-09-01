import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ReferClient } from './refer-client';

export const dynamic = 'force-dynamic';

export default async function ReferPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/refer');
  return <ReferClient />;
}
