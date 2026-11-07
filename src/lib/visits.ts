import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { visitCounters } from '@/lib/db/schema';
import { istDateString } from '@/lib/time';

/** Count one visit (a browser session) for today, platform-wide or for a society's invite page. A bare counter: nothing identifies the visitor. */
export async function recordVisit(societyId = 0, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  await db
    .insert(visitCounters)
    .values({ day: istDateString(now), societyId, count: 1 })
    .onConflictDoUpdate({ target: [visitCounters.day, visitCounters.societyId], set: { count: sql`${visitCounters.count} + 1` } });
}
