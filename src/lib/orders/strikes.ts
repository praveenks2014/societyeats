import { and, eq, gte, isNull, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { orders, sellerProfiles, strikes, users } from '@/lib/db/schema';
import { DAY_MS } from '@/lib/time';

export type StrikeKind = 'seller_cancel' | 'seller_missed' | 'buyer_late_cancel' | 'buyer_unpaid' | 'buyer_no_show' | 'admin';

/**
 * Records a strike and applies the automatic consequence once the limit is reached inside the rolling window:
 *   seller: listings pause (state stays approved; admin lifts) and admins are told
 *   buyer:  ordering is blocked for `buyerBlockDays`; admin can lift it
 * A buyer's late cancellation (after the kitchen accepted) only becomes a strike once they have done it
 * `buyerLateCancelsBeforeStrike` times in the window. Returns whether a strike row was written.
 */
export async function recordStrike(input: { userId: number; role: 'buyer' | 'seller'; kind: StrikeKind; orderId?: number; reason?: string }, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const since = new Date(now.getTime() - settings.strikeWindowDays * DAY_MS);

  if (input.kind === 'buyer_late_cancel') {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.buyerId, input.userId), eq(orders.status, 'cancelled_by_buyer'), gte(orders.cancelledAt, since), sql`${orders.acceptedAt} is not null`));
    if (n < settings.buyerLateCancelsBeforeStrike) return false;
  }

  await db.insert(strikes).values({ userId: input.userId, role: input.role, kind: input.kind, orderId: input.orderId ?? null, reason: input.reason ?? null });
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(strikes)
    .where(and(eq(strikes.userId, input.userId), eq(strikes.role, input.role), gte(strikes.createdAt, since), isNull(strikes.liftedAt)));

  if (input.role === 'seller') {
    await notify(input.userId, 'You received a strike', input.reason ?? 'A cancellation counted as a strike.', '/seller/orders');
    if (count >= settings.sellerStrikeLimit) {
      const [p] = await db.update(sellerProfiles).set({ listingsPausedReason: 'strikes', listingsPausedAt: now }).where(and(eq(sellerProfiles.userId, input.userId), isNull(sellerProfiles.listingsPausedReason))).returning({ id: sellerProfiles.userId });
      if (p) {
        await notify(input.userId, 'Your kitchen is paused', `You reached ${count} strikes in ${settings.strikeWindowDays} days. PadosiPlate will review your kitchen.`, '/seller/inbox');
        await notifyAdmins('Kitchen auto-paused after strikes', `Kitchen #${input.userId} reached ${count} strikes.`, `/admin/kitchens/${input.userId}`);
      }
    }
  } else {
    await notify(input.userId, 'You received a strike', input.reason ?? 'A cancelled order counted as a strike.', '/orders');
    if (count >= settings.buyerStrikeLimit) {
      const until = new Date(now.getTime() + settings.buyerBlockDays * DAY_MS);
      await db.update(users).set({ ordersBlockedUntil: until }).where(eq(users.id, input.userId));
      await notify(input.userId, 'Ordering paused', `Because of ${count} strikes in ${settings.strikeWindowDays} days, you cannot place orders until ${until.toDateString()}. You can appeal from Help.`, '/orders');
      await notifyAdmins('Buyer blocked after strikes', `Buyer #${input.userId} reached ${count} strikes.`, '/admin/users');
    }
  }
  return true;
}

export async function notifyAdmins(title: string, body: string, href: string): Promise<void> {
  const db = await getDb();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  for (const a of admins) await notify(a.id, title, body, href);
}

/**
 * Declining a booked order costs no strike, but it counts against the kitchen's acceptance rate and a pattern is
 * flagged: the moment declines in the window pass `sellerDeclineNudgeCount`, admins get one nudge (not one per decline).
 */
export async function maybeNudgeDeclines(sellerId: number, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const since = new Date(now.getTime() - settings.sellerDeclineNudgeDays * DAY_MS);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), eq(orders.cancelledBy, 'seller'), isNull(orders.acceptedAt), isNotNull(orders.cancelledAt), gte(orders.cancelledAt, since)));
  if (r.n !== settings.sellerDeclineNudgeCount + 1) return false; // exactly crossing the line: one nudge
  const [kitchen] = await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  await notifyAdmins('Kitchen declining many orders', `${kitchen?.name ?? `Kitchen #${sellerId}`} declined ${r.n} booked orders in ${settings.sellerDeclineNudgeDays} days.`, `/admin/kitchens/${sellerId}`);
  return true;
}
