import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, listings, orders, sellerProfiles, subscriptions } from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.userId, session.uid));
  if (!profile) throw new ApiError(404, 'Seller profile missing');

  const [application] = await db
    .select()
    .from(fssaiApplications)
    .where(eq(fssaiApplications.sellerId, session.uid))
    .orderBy(desc(fssaiApplications.createdAt))
    .limit(1);

  const myListings = await db.select().from(listings).where(eq(listings.sellerId, session.uid));
  const myOrders = await db.select().from(orders).where(eq(orders.sellerId, session.uid));
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.sellerId, session.uid));
  const settings = await getPlatformSettings();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const active = myOrders.filter((o) =>
    ['paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivery_unassigned'].includes(o.status),
  );
  // 'delivered' (seller/platform delivery) and 'picked_up' (self-pickup) are
  // both terminal-success states — see DECISIONS.md #37+.
  const todayDelivered = myOrders.filter(
    (o) => (o.status === 'delivered' || o.status === 'picked_up') && o.createdAt >= today,
  );

  let pendingDaysLeft: number | null = null;
  if (profile.fssaiStatus === 'pending_application' && application) {
    const elapsed = (Date.now() - application.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    pendingDaysLeft = Math.max(0, Math.ceil(settings.fssaiPendingMaxDays - elapsed));
  }

  return ok({
    profile,
    application: application ?? null,
    plan: sub?.plan ?? 'free',
    pendingDaysLeft,
    settings: { commissionHomePct: settings.commissionHomePct, fssaiPendingMaxDays: settings.fssaiPendingMaxDays },
    stats: {
      listings: myListings.length,
      activeListings: myListings.filter((l) => l.isActive).length,
      activeOrders: active.length,
      todayOrders: todayDelivered.length,
      todayGrossPaise: todayDelivered.reduce((s, o) => s + o.subtotalInPaise, 0),
    },
  });
});
