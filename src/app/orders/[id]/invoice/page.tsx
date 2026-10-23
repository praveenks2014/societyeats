import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { InvoiceView } from './invoice-client';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/orders/${(await params).id}/invoice`);
  return <InvoiceView orderId={Number((await params).id)} />;
}
