import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { sellerProfiles } from '@/lib/db/schema';
import { RoleNav } from '@/components/role-nav';
import { sellerUnreadCount } from '@/lib/messaging/admin-threads';
import { sellerSubscriptions } from '@/lib/subscriptions/queries';
import { overallStatus } from '@/lib/subscriptions/status';

export const dynamic = 'force-dynamic';

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/seller');
  if (session.role !== 'seller' && session.role !== 'admin') redirect('/');

  let unread = 0;
  let subStatus: string = 'active';
  let state = 'approved';
  let graceDays = 3;
  if (session.role === 'seller') {
    const db = await getDb();
    const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
    state = profile?.listingState ?? 'draft';
    unread = await sellerUnreadCount(session.uid);
    const settings = await getPlatformSettings();
    graceDays = settings.subscriptionGraceDays;
    subStatus = overallStatus(await sellerSubscriptions(session.uid), new Date(), settings.subscriptionGraceDays);
  }

  return (
    <>
      <RoleNav
        title="KITCHEN DASHBOARD"
        tabs={[
          { href: '/seller', label: 'Overview' },
          { href: '/seller/orders', label: 'Orders' },
          { href: '/seller/listings', label: 'My dishes' },
          { href: '/seller/subscription', label: 'Subscription' },
          { href: '/seller/payment-details', label: 'Payment details' },
          { href: '/seller/inbox', label: 'Inbox', badge: unread },
          { href: '/seller/fulfillment', label: 'Fulfillment' },
          { href: '/seller/earnings', label: 'Sales' },
          { href: '/seller/reviews', label: 'Reviews' },
          { href: '/seller/compliance', label: 'FSSAI' },
        ]}
      />
      {session.role === 'seller' && subStatus === 'grace' && (
        <Link href="/seller/subscription" className="mt-4 block rounded-2xl bg-turmeric-tint px-4 py-3 text-sm font-medium text-turmeric-deep" role="alert">
          ⏳ Your subscription has ended. Your dishes stay visible for a {graceDays}-day grace period — renew now to avoid being hidden.
        </Link>
      )}
      {session.role === 'seller' && subStatus === 'expired' && (
        <Link href="/seller/subscription" className="mt-4 block rounded-2xl bg-chili-tint px-4 py-3 text-sm font-medium text-chili-dark" role="alert">
          Your subscription has expired, so your dishes are hidden from buyers. Renew to bring them back instantly — nothing was deleted.
        </Link>
      )}
      {session.role === 'seller' && state === 'delisted' && (
        <Link href="/seller/inbox" className="mt-4 block rounded-2xl bg-chili-tint px-4 py-3 text-sm font-medium text-chili-dark" role="alert">
          Your kitchen has been delisted by PadosiPlate. You can finish orders you already accepted. See your inbox for details.
        </Link>
      )}
      <div className="pt-5">{children}</div>
    </>
  );
}
