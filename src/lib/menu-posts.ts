import { and, eq, inArray } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { favourites, listings, menuPosts, notifications, sellerProfiles } from '@/lib/db/schema';
import { emit } from '@/lib/notify';
import { istDateString } from '@/lib/time';
import { BRAND } from '@/config/brand';

export type MenuPostInput = { listingIds: number[]; note?: string };

/**
 * A kitchen publishes today's menu (one per IST day, republishing replaces it). Followers who asked for “cooking” alerts hear about
 * it once per kitchen per day — a republish later the same day never alerts them again.
 */
export async function publishMenu(sellerId: number, input: MenuPostInput, now: Date = new Date()) {
  const ids = [...new Set(input.listingIds)];
  if (ids.length < 1 || ids.length > 12) throw new ApiError(400, 'Choose between 1 and 12 dishes for today');
  const db = await getDb();
  const dishes = await db.select().from(listings).where(and(inArray(listings.id, ids), eq(listings.sellerId, sellerId)));
  if (dishes.length !== ids.length) throw new ApiError(400, 'One of those dishes is not yours');
  const live = dishes.filter((d) => d.isActive && d.moderationStatus === 'approved');
  if (live.length !== dishes.length) throw new ApiError(400, 'Only live, approved dishes can go on today’s menu');
  const note = input.note?.trim().slice(0, 200) || null;
  const forDate = istDateString(now);
  const [prev] = await db.select().from(menuPosts).where(and(eq(menuPosts.sellerId, sellerId), eq(menuPosts.forDate, forDate)));
  const [row] = await db
    .insert(menuPosts)
    .values({ sellerId, forDate, note, listingIdsJson: ids, publishedAt: now })
    .onConflictDoUpdate({ target: [menuPosts.sellerId, menuPosts.forDate], set: { note, listingIdsJson: ids, publishedAt: now } })
    .returning();
  const alerted = prev ? 0 : await alertFollowers(sellerId, forDate, dishes.map((d) => d.title), note, now);
  return { post: row, alerted };
}

async function alertFollowers(sellerId: number, forDate: string, titles: string[], note: string | null, now: Date): Promise<number> {
  const settings = await getPlatformSettings();
  if (!settings.favouritesEnabled) return 0;
  const db = await getDb();
  const [k] = await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  const followers = await db.select({ userId: favourites.userId }).from(favourites).where(and(eq(favourites.sellerId, sellerId), eq(favourites.notifyCooking, true)));
  const href = `/kitchen/${sellerId}?menu=${forDate}`;
  let n = 0;
  for (const f of followers) {
    const [seen] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, f.userId), eq(notifications.href, href)));
    if (seen) continue;
    await emit('kitchen_cooking', f.userId, { kitchen: k?.name, note, dishes: titles.slice(0, 4).join(', '), href }, now);
    n++;
  }
  return n;
}

export async function getMenuPost(sellerId: number, forDate: string = istDateString()) {
  const db = await getDb();
  const [post] = await db.select().from(menuPosts).where(and(eq(menuPosts.sellerId, sellerId), eq(menuPosts.forDate, forDate)));
  if (!post) return null;
  const dishes = post.listingIdsJson.length ? await db.select().from(listings).where(inArray(listings.id, post.listingIdsJson)) : [];
  return { post, dishes: dishes.filter((d) => d.isActive && d.moderationStatus === 'approved') };
}

/** The WhatsApp share text and a one-tap wa.me link. */
export function shareLink(input: { kitchen: string; dishes: string[]; note?: string | null; url: string }): { text: string; waUrl: string } {
  const dishLine = input.dishes.slice(0, 5).join(', ') + (input.dishes.length > 5 ? ` +${input.dishes.length - 5} more` : '');
  const text = `🍲 ${input.kitchen} is cooking today: ${dishLine}.${input.note ? ` ${input.note}` : ''} Order from your neighbour on ${BRAND.name}: ${input.url}`;
  return { text, waUrl: `https://wa.me/?text=${encodeURIComponent(text)}` };
}
