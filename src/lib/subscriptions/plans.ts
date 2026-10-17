import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { subscriptionPlans } from '@/lib/db/schema';

export const LAUNCH_PLAN_NAME = 'Launch – 3 months';

/** Seeds the single launch plan if there are no plans at all (idempotent; never overrides admin edits). */
export async function seedSubscriptionPlans(db: Db): Promise<void> {
  const existing = await db.select({ id: subscriptionPlans.id }).from(subscriptionPlans).limit(1);
  if (existing.length) return;
  await db.insert(subscriptionPlans).values({ name: LAUNCH_PLAN_NAME, durationMonths: 3, pricePaise: 29900, active: true, sort: 1 });
}

export async function getActivePlans(db: Db) {
  return db.select().from(subscriptionPlans).where(eq(subscriptionPlans.active, true)).orderBy(subscriptionPlans.sort, subscriptionPlans.id);
}
