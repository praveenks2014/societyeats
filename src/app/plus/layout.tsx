import { PaymentsBanner } from '@/components/payments-banner';

export default function PlusLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PaymentsBanner />
      {children}
    </>
  );
}
