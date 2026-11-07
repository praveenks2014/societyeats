import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { isMockPayments } from '@/lib/payments/mode';
import { PaymentsBanner } from '@/components/payments-banner';
import { CheckoutClient } from './checkout-client';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/checkout');
  return (
    <>
      <PaymentsBanner />
      <CheckoutClient mockMode={isMockPayments()} />
    </>
  );
}
