import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { orders, sellerProfiles } from '@/lib/db/schema';
import type { PlatformSettings } from '@/lib/settings/defs';

export type QualityScore = {
  windowDays: number;
  orders: number;
  acceptancePct: number | null;
  cancelPct: number | null;
  onTimePct: number | null;
  rating: number | null;
  ratingCount: number;
  topKitchen: boolean;
  /** What each Top Kitchen requirement looks like right now, so a kitchen can see what to work on. */
  checks: { key: string; label: string; ok: boolean; value: string; need: string }[];
};

type T = Pick<PlatformSettings, 'topKitchenMinOrders' | 'topKitchenMinAcceptancePct' | 'topKitchenMaxCancelPct' | 'topKitchenMinOnTimePct' | 'topKitchenOnTimeMinutes' | 'topKitchenMinRating'>;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Pure: score from a kitchen's last-30-day orders and its rating. Only the kitchen sees the numbers; the public sees the badge. */
export function scoreKitchen(
  rows: { status: string; acceptedAt: Date | null; atDoorAt: Date | null; cancelledBy: string | null }[],
  rating: { avg: number; count: number },
  t: T,
  windowDays = 30,
): QualityScore {
  const accepted = rows.filter((r) => r.acceptedAt).length;
  const declined = rows.filter((r) => !r.acceptedAt && (r.status === 'cancelled_by_seller' || r.status === 'cancelled')).length;
  const missed = rows.filter((r) => r.status === 'cancelled_auto').length;
  const kitchenCancelled = rows.filter((r) => r.acceptedAt && (r.status === 'cancelled_by_seller' || r.status === 'cancelled')).length;
  const reachedDoor = rows.filter((r) => r.acceptedAt && r.atDoorAt);
  const onTime = reachedDoor.filter((r) => r.atDoorAt!.getTime() - r.acceptedAt!.getTime() <= t.topKitchenOnTimeMinutes * 60_000).length;
  const acceptancePct = pct(accepted, accepted + declined + missed);
  const cancelPct = pct(kitchenCancelled + declined + missed, rows.length);
  const onTimePct = pct(onTime, reachedDoor.length);
  const avg = rating.count > 0 ? Math.round(rating.avg * 10) / 10 : null;
  const checks = [
    { key: 'orders', label: 'Orders in 30 days', ok: rows.length >= t.topKitchenMinOrders, value: String(rows.length), need: `at least ${t.topKitchenMinOrders}` },
    { key: 'acceptance', label: 'Acceptance rate', ok: acceptancePct != null && acceptancePct >= t.topKitchenMinAcceptancePct, value: acceptancePct == null ? '–' : `${acceptancePct}%`, need: `at least ${t.topKitchenMinAcceptancePct}%` },
    { key: 'cancel', label: 'Cancelled by you (declines, misses, late cancels)', ok: cancelPct != null && cancelPct <= t.topKitchenMaxCancelPct, value: cancelPct == null ? '–' : `${cancelPct}%`, need: `at most ${t.topKitchenMaxCancelPct}%` },
    { key: 'ontime', label: `At the door within ${t.topKitchenOnTimeMinutes} min`, ok: onTimePct != null && onTimePct >= t.topKitchenMinOnTimePct, value: onTimePct == null ? '–' : `${onTimePct}%`, need: `at least ${t.topKitchenMinOnTimePct}%` },
    { key: 'rating', label: 'Average rating', ok: avg != null && avg >= t.topKitchenMinRating, value: avg == null ? '–' : String(avg), need: `at least ${t.topKitchenMinRating}` },
  ];
  return { windowDays, orders: rows.length, acceptancePct, cancelPct, onTimePct, rating: avg, ratingCount: rating.count, topKitchen: checks.every((c) => c.ok), checks };
}

export async function qualityScore(sellerId: number, now: Date = new Date()): Promise<QualityScore> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await db
    .select({ status: orders.status, acceptedAt: orders.acceptedAt, atDoorAt: orders.atDoorAt, cancelledBy: orders.cancelledBy })
    .from(orders)
    .where(and(eq(orders.sellerId, sellerId), eq(orders.type, 'home_delivery'), gte(orders.bookedAt, since)));
  const [p] = await db.select({ rating: sellerProfiles.rating, count: sellerProfiles.ratingCount }).from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  return scoreKitchen(rows.filter((r) => r.status !== 'fee_pending'), { avg: p?.rating ?? 0, count: p?.count ?? 0 }, settings, 30);
}

/** Which of these kitchens currently hold the public Top Kitchen badge. */
export async function topKitchenSet(sellerIds: number[], now: Date = new Date()): Promise<Set<number>> {
  const out = new Set<number>();
  if (!sellerIds.length) return out;
  for (const id of new Set(sellerIds)) if ((await qualityScore(id, now)).topKitchen) out.add(id);
  return out;
}
