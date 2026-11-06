import { and, eq, inArray, isNotNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { chatReads, grievances, loginCodes, orderMessages, orders, upiVerifications } from '@/lib/db/schema';
import { TERMINAL_STATES } from '@/lib/orders/state';
import { getStorage } from '@/lib/storage';
import { DAY_MS } from '@/lib/time';
import { log } from '@/lib/log';

/**
 * Scheduled data minimisation (DPDP). Every period is an admin setting; each pass is idempotent.
 *   - chats: removed `chatRetentionDays` after the order closed, unless a dispute/report is still open
 *   - verification screenshots: removed `verificationRetentionDays` after the decision
 *   - sign-in codes: removed `loginCodeRetentionHours` after creation
 * The audit log is kept at least `accessLogMinRetentionDays` (never purged here).
 */
export async function runRetention(now: Date = new Date()) {
  const settings = await getPlatformSettings();
  const db = await getDb();
  const storage = await getStorage().catch(() => null);

  // --- chats ---
  const chatCutoff = new Date(now.getTime() - settings.chatRetentionDays * DAY_MS);
  const closed = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.status, TERMINAL_STATES), or(and(isNotNull(orders.completedAt), lt(orders.completedAt, chatCutoff)), and(isNotNull(orders.cancelledAt), lt(orders.cancelledAt, chatCutoff)))));
  let chatMessages = 0;
  if (closed.length) {
    const ids = closed.map((o) => o.id);
    const openDisputes = await db.select({ orderId: grievances.orderId }).from(grievances).where(and(inArray(grievances.orderId, ids), notInArray(grievances.status, ['resolved', 'closed'])));
    const hold = new Set(openDisputes.map((g) => g.orderId));
    const purgeIds = ids.filter((id) => !hold.has(id));
    if (purgeIds.length) {
      const msgs = await db.select({ id: orderMessages.id, imageKey: orderMessages.imageKey }).from(orderMessages).where(inArray(orderMessages.orderId, purgeIds));
      for (const m of msgs) if (m.imageKey && storage) await storage.delete(m.imageKey).catch(() => {});
      chatMessages = msgs.length;
      if (msgs.length) await db.delete(orderMessages).where(inArray(orderMessages.orderId, purgeIds));
      await db.delete(chatReads).where(inArray(chatReads.orderId, purgeIds));
    }
  }

  // --- verification screenshots ---
  const verCutoff = new Date(now.getTime() - settings.verificationRetentionDays * DAY_MS);
  const evid = await db
    .select({ id: upiVerifications.id, key: upiVerifications.evidenceFileKey })
    .from(upiVerifications)
    .where(and(isNotNull(upiVerifications.evidenceFileKey), lt(sql`coalesce(${upiVerifications.completedAt}, ${upiVerifications.createdAt})`, verCutoff), notInArray(upiVerifications.status, ['needs_manual_review', 'pending'])));
  for (const e of evid) {
    if (e.key && storage) await storage.delete(e.key).catch(() => {});
    await db.update(upiVerifications).set({ evidenceFileKey: null }).where(eq(upiVerifications.id, e.id));
  }

  // --- sign-in codes ---
  const codeCutoff = new Date(now.getTime() - settings.loginCodeRetentionHours * 3_600_000);
  const codes = await db.delete(loginCodes).where(lt(loginCodes.createdAt, codeCutoff)).returning({ id: loginCodes.id });

  const result = { chatMessages, verificationScreenshots: evid.length, loginCodes: codes.length };
  if (chatMessages || evid.length || codes.length) log.info('retention.run', result);
  return result;
}

/** Guard used by anything that might delete audit rows: they must be at least `accessLogMinRetentionDays` old. */
export async function purgeableAuditCutoff(now: Date = new Date()): Promise<Date> {
  const settings = await getPlatformSettings();
  return new Date(now.getTime() - settings.accessLogMinRetentionDays * DAY_MS);
}
