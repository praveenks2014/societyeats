import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { effectiveGstBps, subscriptionCharge } from '@/lib/money';
import { getActivePlans } from '@/lib/subscriptions/plans';
import { sellerSubscriptions } from '@/lib/subscriptions/queries';
import { startSubscriptionPayment } from '@/lib/subscriptions/service';
import { daysLeft, effectiveStatus, overallStatus } from '@/lib/subscriptions/status';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [settings, subs, plans] = await Promise.all([getPlatformSettings(), sellerSubscriptions(session.uid), getActivePlans(db)]);
  const now = new Date();
  const gstBps = effectiveGstBps(settings.platformFeeGstBps, settings.platformGstin);
  return ok({
    status: overallStatus(subs, now, settings.subscriptionGraceDays),
    daysLeft: daysLeft(subs, now),
    graceDays: settings.subscriptionGraceDays,
    plans: plans.map((p) => ({ ...p, charge: subscriptionCharge(p.pricePaise, gstBps) })),
    gstApplies: gstBps > 0,
    history: subs
      .filter((s) => s.status !== 'cancelled' || s.paidAt)
      .map((s) => ({ ...s, effectiveStatus: effectiveStatus(s, now, settings.subscriptionGraceDays), totalPaise: s.pricePaiseSnapshot + s.gstPaise, hasInvoice: !!s.paidAt })),
  });
});

const schema = z.object({ planId: z.number().int() });

/** Start a one-time payment for a plan; the response drives Razorpay Checkout (or the mock sheet). */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Choose a plan');
  return ok({ checkout: await startSubscriptionPayment(session.uid, parsed.data.planId) });
});
