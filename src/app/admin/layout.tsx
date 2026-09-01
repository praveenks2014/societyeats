import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { RoleNav } from '@/components/role-nav';
import { getPlatformSettings } from '@/lib/db/platform';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');
  if (session.role !== 'admin') redirect('/');
  const settings = await getPlatformSettings();
  return (
    <>
      <RoleNav
        title="GHARSE MISSION CONTROL"
        tabs={[
          { href: '/admin', label: 'Overview' },
          { href: '/admin/sellers', label: 'Sellers' },
          { href: '/admin/fssai', label: 'FSSAI queue' },
          { href: '/admin/complaints', label: 'Complaints' },
          { href: '/admin/providers', label: 'Delivery providers' },
          { href: '/admin/orders', label: 'Orders' },
          { href: '/admin/payouts', label: 'Payouts' },
          { href: '/admin/settings', label: 'Settings' },
        ]}
      />
      {!settings.platformFssaiCentralLicenseNo && (
        <Link
          href="/admin/settings"
          className="mt-4 block rounded-2xl bg-chili-tint px-4 py-3 text-sm font-medium text-chili-dark hover:bg-chili-tint/70"
        >
          ⚠️ Live orders blocked until platform FSSAI Central License is entered — add it in
          Settings.
        </Link>
      )}
      <div className="pt-5">{children}</div>
    </>
  );
}
