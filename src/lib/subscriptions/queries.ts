import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { kitchenSubscriptions } from '@/lib/db/schema';
import { isSubscribed, overallStatus, type SubStatus } from './status';

export async function sellerSubscriptions(sellerId: number) {
  const db = await getDb();
  return db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.sellerId, sellerId)).orderBy(desc(kitchenSubscriptions.createdAt));
}

/** True while the kitchen has an active, waived or in-grace period. */
export async function sellerIsSubscribed(sellerId: number, now: Date = new Date()): Promise<boolean> {
  const [subs, settings] = await Promise.all([sellerSubscriptions(sellerId), getPlatformSettings()]);
  return isSubscribed(subs, now, settings.subscriptionGraceDays);
}

export async function sellerSubscriptionStatus(sellerId: number, now: Date = new Date()): Promise<SubStatus | 'none'> {
  const [subs, settings] = await Promise.all([sellerSubscriptions(sellerId), getPlatformSettings()]);
  return overallStatus(subs, now, settings.subscriptionGraceDays);
}
