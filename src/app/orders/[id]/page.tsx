import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { isMockMode } from '@/lib/config';
import { OrderDetail } from './order-detail';

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/orders/${params.id}`);
  return <OrderDetail orderId={Number(params.id)} mockMode={isMockMode()} />;
}
