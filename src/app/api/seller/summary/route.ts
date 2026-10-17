import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { fssaiApplications, kitchenRefundsDue, listings, orders, sellerProfiles } from '@/lib/db/schema';
import { fssaiDeemedGrantInfo } from '@/lib/fssai/gate';
import { maybeNotifyDeemedGrantWindow } from '@/lib/fssai/reminders';
import { sellerUnreadCount } from '@/lib/messaging/admin-threads';
import { sellerSubscriptions } from '@/lib/subscriptions/queries';
import { daysLeft, effectiveStatus, overallStatus } from '@/lib/subscriptions/status';
import { istStartOfDay } from '@/lib/time';
import { and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!profile) throw new ApiError(404, 'Seller profile missing');

  const [application] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, session.uid)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const myListings = await db.select().from(listings).where(eq(listings.sellerId, session.uid));
  const myOrders = await db.select().from(orders).where(eq(orders.sellerId, session.uid));
  const settings = await getPlatformSettings();
  const subs = await sellerSubscriptions(session.uid);
  const now = new Date();
  const unread = await sellerUnreadCount(session.uid);
  const dueRows = await db.select().from(kitchenRefundsDue).where(and(eq(kitchenRefundsDue.sellerId, session.uid), eq(kitchenRefundsDue.status, 'due')));

  const today = istStartOfDay();
  const active = myOrders.filter((o) => ['fee_paid', 'awaiting_kitchen_payment_confirmation', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivery_unassigned'].includes(o.status));
  const todayDone = myOrders.filter((o) => (o.status === 'delivered' || o.status === 'picked_up') && (o.completedAt ?? o.createdAt) >= today);

  // Lazy, dedupe-on-read FSSAI reminder (see src/lib/fssai/reminders.ts).
  const fssaiDeemedGrant = fssaiDeemedGrantInfo(application ?? null);
  await maybeNotifyDeemedGrantWindow(session.uid, application ?? null);

  const status = overallStatus(subs, now, settings.subscriptionGraceDays);
  const current = subs.map((s) => ({ s, e: effectiveStatus(s, now, settings.subscriptionGraceDays) })).find((x) => ['active', 'waived', 'grace'].includes(x.e));
  return ok({
    profile,
    application: application ?? null,
    fssaiDeemedGrant,
    subscription: { status, daysLeft: daysLeft(subs, now), inGrace: status === 'grace', endsAt: current?.s.endsAt ?? null, graceDays: settings.subscriptionGraceDays },
    inboxUnread: unread,
    refundsDue: { count: dueRows.length, totalPaise: dueRows.reduce((s, r) => s + r.amountInPaise, 0) },
    stats: {
      listings: myListings.length,
      activeListings: myListings.filter((l) => l.isActive).length,
      activeOrders: active.length,
      todayOrders: todayDone.length,
      todayFoodPaise: todayDone.reduce((s, o) => s + o.foodTotalInPaise, 0),
    },
  });
});
