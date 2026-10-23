import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { adminKitchenMessages, adminKitchenThreads, sellerProfiles, users } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { siteOriginSafe } from '@/lib/site-url';

export type Attachment = { url: string; name: string };

async function emailSeller(sellerId: number, subject: string, body: string) {
  const db = await getDb();
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, sellerId));
  if (u?.email) {
    await sendEmail({ userId: sellerId, to: u.email, kind: 'admin_message', subject: `[PadosiPlate] ${subject}`, text: `${body}\n\nReply in your inbox: ${siteOriginSafe()}/seller/inbox` });
  }
}

/** Admin starts a thread with a kitchen (or posts into an existing one when threadId is given). */
export async function adminSend(opts: { adminId: number; sellerId: number; subject?: string; body: string; threadId?: number; attachments?: Attachment[] }) {
  const db = await getDb();
  if (!opts.body.trim()) throw new ApiError(400, 'Write a message first');
  const [seller] = await db.select({ id: sellerProfiles.userId }).from(sellerProfiles).where(eq(sellerProfiles.userId, opts.sellerId));
  if (!seller) throw new ApiError(404, 'Kitchen not found');
  let threadId = opts.threadId;
  let subject = opts.subject?.trim() || 'Message from PadosiPlate';
  if (threadId) {
    const [t] = await db.select().from(adminKitchenThreads).where(eq(adminKitchenThreads.id, threadId));
    if (!t || t.sellerId !== opts.sellerId) throw new ApiError(404, 'Thread not found');
    subject = t.subject;
  } else {
    const [t] = await db.insert(adminKitchenThreads).values({ sellerId: opts.sellerId, subject, createdByAdminId: opts.adminId }).returning();
    threadId = t.id;
  }
  const [msg] = await db
    .insert(adminKitchenMessages)
    .values({ threadId, senderId: opts.adminId, senderRole: 'admin', body: opts.body.trim(), attachmentsJson: opts.attachments?.length ? opts.attachments : null })
    .returning();
  await db.update(adminKitchenThreads).set({ lastMessageAt: new Date() }).where(eq(adminKitchenThreads.id, threadId));
  await notify(opts.sellerId, `New message: ${subject}`, opts.body.trim().slice(0, 140), '/seller/inbox');
  await emailSeller(opts.sellerId, subject, opts.body.trim());
  await recordAudit({ actorId: opts.adminId, action: 'inbox.message', targetType: 'kitchen', targetId: opts.sellerId, meta: { threadId } });
  return { threadId, messageId: msg.id };
}

/** Seller replies inside an existing thread. */
export async function sellerReply(opts: { sellerId: number; threadId: number; body: string; attachments?: Attachment[] }) {
  const db = await getDb();
  if (!opts.body.trim()) throw new ApiError(400, 'Write a message first');
  const [t] = await db.select().from(adminKitchenThreads).where(and(eq(adminKitchenThreads.id, opts.threadId), eq(adminKitchenThreads.sellerId, opts.sellerId)));
  if (!t) throw new ApiError(404, 'Thread not found');
  const [msg] = await db
    .insert(adminKitchenMessages)
    .values({ threadId: t.id, senderId: opts.sellerId, senderRole: 'seller', body: opts.body.trim(), attachmentsJson: opts.attachments?.length ? opts.attachments : null })
    .returning();
  await db.update(adminKitchenThreads).set({ lastMessageAt: new Date() }).where(eq(adminKitchenThreads.id, t.id));
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  for (const a of admins) await notify(a.id, `Kitchen replied: ${t.subject}`, opts.body.trim().slice(0, 140), '/admin/inbox');
  return { messageId: msg.id };
}

/** Marks the other side's messages in a thread as read for `viewer`. */
export async function markThreadRead(threadId: number, viewer: 'admin' | 'seller') {
  const db = await getDb();
  await db
    .update(adminKitchenMessages)
    .set({ readAt: new Date() })
    .where(and(eq(adminKitchenMessages.threadId, threadId), isNull(adminKitchenMessages.readAt), ne(adminKitchenMessages.senderRole, viewer)));
}

export async function sellerUnreadCount(sellerId: number): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(adminKitchenMessages)
    .innerJoin(adminKitchenThreads, eq(adminKitchenMessages.threadId, adminKitchenThreads.id))
    .where(and(eq(adminKitchenThreads.sellerId, sellerId), eq(adminKitchenMessages.senderRole, 'admin'), isNull(adminKitchenMessages.readAt)));
  return Number(rows[0]?.n ?? 0);
}

export async function adminUnreadCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ n: sql<number>`count(*)` }).from(adminKitchenMessages).where(and(eq(adminKitchenMessages.senderRole, 'seller'), isNull(adminKitchenMessages.readAt)));
  return Number(rows[0]?.n ?? 0);
}

export async function listThreads(filter: { sellerId?: number; societyId?: number; unreadFor?: 'admin' | 'seller' }) {
  const db = await getDb();
  const rows = await db
    .select({ t: adminKitchenThreads, kitchen: sellerProfiles.kitchenName, societyId: users.societyId })
    .from(adminKitchenThreads)
    .innerJoin(sellerProfiles, eq(adminKitchenThreads.sellerId, sellerProfiles.userId))
    .innerJoin(users, eq(adminKitchenThreads.sellerId, users.id))
    .where(and(filter.sellerId ? eq(adminKitchenThreads.sellerId, filter.sellerId) : undefined, filter.societyId ? eq(users.societyId, filter.societyId) : undefined))
    .orderBy(desc(adminKitchenThreads.lastMessageAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.t.id);
  const msgs = await db.select().from(adminKitchenMessages).where(inArray(adminKitchenMessages.threadId, ids)).orderBy(desc(adminKitchenMessages.createdAt));
  const out = rows.map((r) => {
    const mine = msgs.filter((m) => m.threadId === r.t.id);
    const unread = filter.unreadFor ? mine.filter((m) => !m.readAt && m.senderRole !== filter.unreadFor).length : 0;
    return { ...r.t, kitchenName: r.kitchen, societyId: r.societyId, lastMessage: mine[0]?.body ?? '', lastSender: mine[0]?.senderRole ?? null, unread };
  });
  return out;
}

export async function getThread(threadId: number) {
  const db = await getDb();
  const [t] = await db.select().from(adminKitchenThreads).where(eq(adminKitchenThreads.id, threadId));
  if (!t) return null;
  const messages = await db.select().from(adminKitchenMessages).where(eq(adminKitchenMessages.threadId, threadId)).orderBy(adminKitchenMessages.createdAt);
  return { thread: t, messages };
}

export const DEFAULT_TEMPLATES = [
  { title: 'Photos need improvement', body: 'Hi! Thanks for applying. Your kitchen photos need to be clearer before we can approve your listing — please upload bright, well-lit photos of your cooking area and 2–3 of your dishes, then resubmit.' },
  { title: 'FSSAI document unclear', body: 'Hi! The FSSAI document you uploaded is hard to read. Please upload a clear, full-page photo or PDF of your registration/licence certificate so we can verify it.' },
  { title: 'Subscription expiring', body: 'Hi! Your PadosiPlate kitchen subscription is about to end. Renew from Seller → Subscription to keep your dishes visible to your neighbours without a break.' },
  { title: 'Customer complaint follow-up', body: 'Hi! A neighbour raised a concern about a recent order. Please check your orders and reply here with your side so we can resolve it fairly.' },
];
