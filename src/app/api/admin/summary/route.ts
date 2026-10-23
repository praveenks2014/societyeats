import { eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { complaints, fssaiApplications, orders, providerHealth, sellerProfiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const allOrders = await db.select().from(orders);
  const sellers = await db.select().from(sellerProfiles);
  const apps = await db.select().from(fssaiApplications);
  const providers = await db.select().from(providerHealth);
  const complaintRows = await db.select().from(complaints);

  const active = allOrders.filter((o) =>
    ['fee_paid', 'awaiting_kitchen_payment_confirmation', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery'].includes(o.status),
  );
  return ok({
    stats: {
      totalOrders: allOrders.length,
      activeOrders: active.length,
      unassigned: allOrders.filter((o) => o.status === 'delivery_unassigned').length,
      // GMV = food value kitchens were paid directly (the platform never held it).
      gmvPaise: allOrders
        .filter((o) => ['delivered', 'picked_up'].includes(o.status))
        .reduce((s, o) => s + o.foodTotalInPaise, 0),
      platformFeePaise: allOrders
        .filter((o) => ['delivered', 'picked_up'].includes(o.status))
        .reduce((s, o) => s + o.platformFeeInPaise, 0),
      sellersAwaitingApproval: sellers.filter((s) => s.listingState === 'submitted').length,
      fssaiQueue: apps.filter((a) => ['submitted_to_backoffice', 'filed_on_foscos'].includes(a.status)).length,
      providersDown: providers.filter((p) => !p.isEnabled).length,
      openComplaints: complaintRows.filter((c) => c.status === 'open').length,
    },
  });
});
