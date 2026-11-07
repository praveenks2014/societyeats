import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { subscriptionPlans } from '@/lib/db/schema';

/** Kept for older references; the Pilot v2 catalogue is below. */
export const LAUNCH_PLAN_NAME = 'Monthly';
export const FOUNDING_PLAN_NAME = 'Founding kitchen';

/**
 * Pilot v2 listing plans (idempotent; never overrides admin edits):
 *   Founding kitchen  ₹0 for the first 90 days — granted automatically on approval, not purchasable
 *   Monthly           ₹199
 *   Quarterly         ₹499
 *   Yearly            ₹1,799
 */
export async function seedSubscriptionPlans(db: Db): Promise<void> {
  const existing = await db.select({ id: subscriptionPlans.id }).from(subscriptionPlans).limit(1);
  if (existing.length) return;
  await db.insert(subscriptionPlans).values([
    { name: 'Monthly', durationMonths: 1, pricePaise: 19_900, active: true, sort: 1 },
    { name: 'Quarterly', durationMonths: 3, pricePaise: 49_900, active: true, sort: 2 },
    { name: 'Yearly', durationMonths: 12, pricePaise: 179_900, active: true, sort: 3 },
    { name: FOUNDING_PLAN_NAME, durationMonths: 3, pricePaise: 0, active: false, sort: 0 },
  ]);
}

export async function getActivePlans(db: Db) {
  return db.select().from(subscriptionPlans).where(eq(subscriptionPlans.active, true)).orderBy(subscriptionPlans.sort, subscriptionPlans.id);
}
