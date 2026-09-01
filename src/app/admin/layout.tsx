import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { RoleNav } from '@/components/role-nav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');
  if (session.role !== 'admin') redirect('/');
  return (
    <>
      <RoleNav
        title="GHARSE MISSION CONTROL"
        tabs={[
          { href: '/admin', label: 'Overview' },
          { href: '/admin/sellers', label: 'Sellers' },
          { href: '/admin/fssai', label: 'FSSAI queue' },
          { href: '/admin/providers', label: 'Delivery providers' },
          { href: '/admin/orders', label: 'Orders' },
          { href: '/admin/payouts', label: 'Payouts' },
          { href: '/admin/settings', label: 'Settings' },
        ]}
      />
      <div className="pt-5">{children}</div>
    </>
  );
}
