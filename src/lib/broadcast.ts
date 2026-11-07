import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { broadcasts, notificationPrefs, sellerProfiles, users } from '@/lib/db/schema';
import { emit } from '@/lib/notify';

export type Audience = { type: 'all' | 'kitchens' | 'societies'; societyIds?: number[] };
export type BroadcastKind = 'service' | 'marketing';

/**
 * Who a broadcast reaches. Never admins; never blocked accounts. “Kitchens” = people with a kitchen profile; “societies” = members of
 * the chosen societies (residents and kitchens alike). A MARKETING message reaches only people who switched offers on; a SERVICE
 * message (outage, rule change, safety) reaches everyone in the audience and is labelled as such.
 */
export async function resolveAudience(a: Audience, kind: BroadcastKind): Promise<{ userIds: number[]; skippedNoOptIn: number }> {
  const db = await getDb();
  const base = and(ne(users.role, 'admin'), isNull(users.blockedAt), isNull(users.anonymizedAt));
  let ids: number[];
  if (a.type === 'kitchens') {
    ids = (await db.select({ id: users.id }).from(users).innerJoin(sellerProfiles, eq(sellerProfiles.userId, users.id)).where(base)).map((r) => r.id);
  } else if (a.type === 'societies') {
    if (!a.societyIds?.length) throw new ApiError(400, 'Choose at least one society');
    ids = (await db.select({ id: users.id }).from(users).where(and(base, inArray(users.societyId, a.societyIds)))).map((r) => r.id);
  } else {
    ids = (await db.select({ id: users.id }).from(users).where(base)).map((r) => r.id);
  }
  if (kind === 'service' || ids.length === 0) return { userIds: ids, skippedNoOptIn: 0 };
  const opted = new Set((await db.select({ id: notificationPrefs.userId }).from(notificationPrefs).where(and(inArray(notificationPrefs.userId, ids), eq(notificationPrefs.marketingEnabled, true)))).map((r) => r.id));
  return { userIds: ids.filter((i) => opted.has(i)), skippedNoOptIn: ids.length - opted.size };
}

export async function previewBroadcast(a: Audience, kind: BroadcastKind) {
  const r = await resolveAudience(a, kind);
  return { recipients: r.userIds.length, skippedNoOptIn: r.skippedNoOptIn };
}

export async function sendBroadcast(input: { audience: Audience; kind: BroadcastKind; title: string; body: string; adminId: number; expectedRecipients?: number }) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3 || title.length > 120) throw new ApiError(400, 'The title must be 3–120 characters');
  if (body.length < 10 || body.length > 2000) throw new ApiError(400, 'The message must be 10–2000 characters');
  const { userIds, skippedNoOptIn } = await resolveAudience(input.audience, input.kind);
  if (userIds.length === 0) throw new ApiError(400, 'No one would receive this' + (input.kind === 'marketing' ? ' (nobody in this audience has opted in to offers)' : ''));
  // The admin confirmed a recipient count on the preview; if the audience changed since, they must look again.
  if (input.expectedRecipients != null && input.expectedRecipients !== userIds.length) throw new ApiError(409, `The audience changed (now ${userIds.length} people). Preview again before sending.`);
  const db = await getDb();
  const [row] = await db.insert(broadcasts).values({ adminId: input.adminId, audienceJson: input.audience, kind: input.kind, title, body, recipients: userIds.length, skippedNoOptIn }).returning();
  for (const id of userIds) await emit('broadcast', id, { title, body, kind: input.kind, href: '/' });
  await recordAudit({ actorId: input.adminId, action: 'broadcast.send', targetType: 'broadcast', targetId: row.id, meta: { audience: input.audience, kind: input.kind, recipients: userIds.length } });
  return { id: row.id, recipients: userIds.length, skippedNoOptIn };
}

export async function broadcastHistory(limit = 30) {
  const db = await getDb();
  return db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(limit);
}
