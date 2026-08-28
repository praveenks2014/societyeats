import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { isMockMode } from '@/lib/config';
import { CheckoutClient } from './checkout-client';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/checkout');
  return <CheckoutClient mockMode={isMockMode()} />;
}
