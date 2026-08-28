import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { OrdersList } from './orders-list';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/orders');
  return <OrdersList />;
}
