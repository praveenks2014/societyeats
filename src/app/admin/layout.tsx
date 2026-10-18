import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { RoleNav } from '@/components/role-nav';
import { getPlatformSettings } from '@/lib/db/platform';
import { adminUnreadCount } from '@/lib/messaging/admin-threads';
import { getCronStatus } from '@/lib/cron-status';
import { BRAND } from '@/config/brand';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');
  if (session.role !== 'admin') redirect('/');
  if (session.mustChangePassword) redirect('/change-password');
  const settings = await getPlatformSettings();
  const unread = await adminUnreadCount();
  const cron = await getCronStatus();
  return (
    <>
      <RoleNav
        title={`${BRAND.appName.toUpperCase()} MISSION CONTROL`}
        tabs={[
          { href: '/admin', label: 'Overview' },
          { href: '/admin/revenue', label: 'Revenue' },
          { href: '/admin/kitchens/requests', label: 'Requests' },
          { href: '/admin/kitchens', label: 'Kitchens' },
          { href: '/admin/dishes/review', label: 'Dish review' },
          { href: '/admin/societies', label: 'Societies' },
          { href: '/admin/inbox', label: 'Inbox', badge: unread },
          { href: '/admin/users', label: 'Users' },
          { href: '/admin/orders', label: 'Orders' },
          { href: '/admin/complaints', label: 'Complaints' },
          { href: '/admin/refunds', label: 'Refunds' },
          { href: '/admin/fssai', label: 'FSSAI' },
          { href: '/admin/metrics', label: 'Pilot metrics' },
          { href: '/admin/outbox', label: 'Email outbox' },
          { href: '/admin/settings', label: 'Settings' },
        ]}
      />
      {!settings.platformFssaiCentralLicenseNo && (
        <Link href="/admin/settings" className="mt-4 block rounded-2xl bg-chili-tint px-4 py-3 text-sm font-medium text-chili-dark hover:bg-chili-tint/70">
          ⚠️ Live orders are blocked until the platform’s own FSSAI e-commerce registration is entered — add it in Settings.
        </Link>
      )}
      {cron.stale && (
        <div className="mt-4 rounded-2xl bg-chili-tint px-4 py-3 text-sm font-medium text-chili-dark" role="alert" data-testid="cron-warning">
          ⚠️ Scheduled jobs have not run {cron.lastRunAt ? `since ${cron.lastRunAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST (over 3 hours)` : 'yet'}. Subscription expiry and grace, reminders, unpaid-order expiry and document retention are paused. Schedule <code>POST /api/cron/run</code> hourly — see the README (“Scheduled jobs on Autoscale”).
        </div>
      )}
      <div className="pt-5">{children}</div>
    </>
  );
}
