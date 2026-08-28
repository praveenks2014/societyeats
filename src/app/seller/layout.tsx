import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { RoleNav } from '@/components/role-nav';

export const dynamic = 'force-dynamic';

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/seller');
  if (session.role !== 'seller' && session.role !== 'admin') redirect('/');
  return (
    <>
      <RoleNav
        title="KITCHEN DASHBOARD"
        tabs={[
          { href: '/seller', label: 'Overview' },
          { href: '/seller/orders', label: 'Orders' },
          { href: '/seller/listings', label: 'My dishes' },
          { href: '/seller/earnings', label: 'Earnings' },
          { href: '/seller/compliance', label: 'FSSAI & Compliance' },
        ]}
      />
      <div className="pt-5">{children}</div>
    </>
  );
}
