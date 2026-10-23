import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { RoleNav } from '@/components/role-nav';
import { getPlatformSettings } from '@/lib/db/platform';

export const dynamic = 'force-dynamic';

export default async function RestaurantLayout({ children }: { children: React.ReactNode }) {
  // Feature-flagged off for the pilot (restaurantConsoleEnabled), like Mall Mode.
  if (!(await getPlatformSettings()).restaurantConsoleEnabled) notFound();
  const session = await getSession();
  if (!session) redirect('/login?next=/restaurant');
  if (session.role !== 'restaurant' && session.role !== 'admin') redirect('/');
  return (
    <>
      <RoleNav
        title="COUNTER CONSOLE"
        tabs={[
          { href: '/restaurant', label: 'Order queue' },
          { href: '/restaurant/inventory', label: 'Live inventory' },
        ]}
      />
      <div className="pt-5">{children}</div>
    </>
  );
}
