import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { kitchenSubscriptions, sellerProfiles, subscriptionPlans } from '@/lib/db/schema';
import { refundSubscriptionPayment } from '@/lib/payments/refunds';
import { cancelSubscription, extendSubscription, grantSubscription } from '@/lib/subscriptions/service';
import { effectiveStatus } from '@/lib/subscriptions/status';

export const dynamic = 'force-dynamic';

/** All subscription periods (optionally one kitchen) plus the plan catalogue. */
export const GET = api(async (req) => {
  await requireSession(['admin']);
  const sellerId = Number(req.nextUrl.searchParams.get('sellerId')) || null;
  const db = await getDb();
  const settings = await getPlatformSettings();
  const rows = await db
    .select({ s: kitchenSubscriptions, kitchenName: sellerProfiles.kitchenName })
    .from(kitchenSubscriptions)
    .innerJoin(sellerProfiles, eq(kitchenSubscriptions.sellerId, sellerProfiles.userId))
    .where(sellerId ? eq(kitchenSubscriptions.sellerId, sellerId) : undefined)
    .orderBy(desc(kitchenSubscriptions.id))
    .limit(200);
  const plans = await db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sort, subscriptionPlans.id);
  const now = new Date();
  return ok({
    subscriptions: rows.map((r) => ({ ...r.s, kitchenName: r.kitchenName, effectiveStatus: effectiveStatus(r.s, now, settings.subscriptionGraceDays), totalPaise: r.s.pricePaiseSnapshot + r.s.gstPaise })),
    plans,
  });
});

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grant'), sellerId: z.number().int(), months: z.number().int().min(1).max(12), reason: z.string().trim().min(1, 'A reason is required').max(500) }),
  z.object({ action: z.literal('extend'), subscriptionId: z.number().int(), days: z.number().int().min(1).max(366), reason: z.string().trim().min(1, 'A reason is required').max(500) }),
  z.object({ action: z.literal('cancel'), subscriptionId: z.number().int(), reason: z.string().trim().min(1, 'A reason is required').max(500) }),
  z.object({ action: z.literal('refund'), subscriptionId: z.number().int(), amountInPaise: z.number().int().positive().optional(), reason: z.string().trim().min(1, 'A reason is required').max(500) }),
  z.object({ action: z.literal('plan_save'), id: z.number().int().optional(), name: z.string().trim().min(2).max(80), durationMonths: z.number().int().min(1).max(12), pricePaise: z.number().int().min(100).max(10_000_000), active: z.boolean(), sort: z.number().int().min(0).max(999).optional() }),
]);

export const POST = api(async (req) => {
  const admin = await requireSession(['admin']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const a = parsed.data;
  const db = await getDb();
  switch (a.action) {
    case 'grant':
      return ok({ subscription: await grantSubscription({ adminId: admin.uid, sellerId: a.sellerId, months: a.months, reason: a.reason }) });
    case 'extend':
      return ok({ subscription: await extendSubscription({ adminId: admin.uid, subscriptionId: a.subscriptionId, days: a.days, reason: a.reason }) });
    case 'cancel':
      return ok({ subscription: await cancelSubscription({ adminId: admin.uid, subscriptionId: a.subscriptionId, reason: a.reason }) });
    case 'refund':
      await recordAudit({ actorId: admin.uid, action: 'subscription.refund', targetType: 'subscription', targetId: a.subscriptionId, meta: { amount: a.amountInPaise, reason: a.reason } });
      return ok({ refund: await refundSubscriptionPayment({ subscriptionId: a.subscriptionId, amountInPaise: a.amountInPaise, reason: a.reason, adminId: admin.uid }) });
    case 'plan_save': {
      const values = { name: a.name, durationMonths: a.durationMonths, pricePaise: a.pricePaise, active: a.active, sort: a.sort ?? 0 };
      const [plan] = a.id ? await db.update(subscriptionPlans).set(values).where(eq(subscriptionPlans.id, a.id)).returning() : await db.insert(subscriptionPlans).values(values).returning();
      await recordAudit({ actorId: admin.uid, action: 'plan.save', targetType: 'plan', targetId: plan.id, meta: values });
      return ok({ plan });
    }
  }
});
