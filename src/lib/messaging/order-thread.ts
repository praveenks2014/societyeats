import { TERMINAL_STATES, type OrderStatus } from '@/lib/orders/state';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { chatReads, files, grievances, orderMessages, orders, sellerProfiles, societies, userBlocks, users } from '@/lib/db/schema';
import type { Session } from '@/lib/auth';
import { createGrievance } from '@/lib/grievances';
import { checkOutgoing, hasAbuse, isPaymentRequest, type ChatWarning } from '@/lib/chat/filter';
import { fileUrl } from '@/lib/storage/files';

/**
 * Per-order buyer ↔ kitchen chat (Pilot v2 step 8).
 *   • Opens when the order is booked (the fee is paid) and closes `chatReadOnlyHours` after it ends.
 *   • Identities: buyer = first name + society, kitchen = kitchen name. No flat, surname or phone unless that
 *     person switches “Share my number” on for this order.
 *   • Admins can read only when the order has a dispute, a chat report or a reported message — through
 *     `adminReadThread`, which needs a reason and a fresh 2FA check and is audit-logged.
 */

export const QUICK_REPLIES: { key: string; role: 'buyer' | 'seller' | 'both'; text: string }[] = [
  { key: 'late10', role: 'seller', text: 'Running 10 min late' },
  { key: 'at_gate', role: 'seller', text: 'At your gate' },
  { key: 'ready_pickup', role: 'seller', text: 'Ready for pickup' },
  { key: 'upi_check', role: 'seller', text: 'I could not see your UPI payment yet. Could you check the UTR?' },
  { key: 'leave_door', role: 'buyer', text: 'Please leave at door' },
  { key: 'coming_down', role: 'buyer', text: 'Coming down' },
  { key: 'ring_bell', role: 'buyer', text: 'Ring the bell' },
  { key: 'refund', role: 'buyer', text: "I'd like a refund for…" },
  { key: 'thanks', role: 'buyer', text: 'Food was great, thank you!' },
];

/** Back-compat shim for older callers/tests: true when the (default) abusive-word list matches. */
export function hasProfanity(text: string, wordsCsv = 'fuck,shit,bitch,asshole,bastard,madarchod,behenchod,chutiya,bhosdi,randi,harami,gaandu,kutta,saala'): boolean {
  return hasAbuse(text, wordsCsv);
}

export function threadState(
  order: { status: string; completedAt: Date | null; cancelledAt?: Date | null; updatedAt: Date },
  now: Date = new Date(),
  readOnlyHours = 48,
): { open: boolean; reason?: string } {
  if (order.status === 'expired') return { open: false, reason: 'This order expired.' };
  const ended = TERMINAL_STATES.includes(order.status as OrderStatus);
  if (!ended) return { open: true };
  const endedAt = (order.completedAt ?? order.cancelledAt ?? order.updatedAt).getTime();
  if (now.getTime() - endedAt > readOnlyHours * 3_600_000) return { open: false, reason: `Messages close ${readOnlyHours} hours after an order ends.` };
  return { open: true };
}

type Party = 'buyer' | 'seller' | 'admin';

async function loadOrder(orderId: number) {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.type !== 'home_delivery' || order.status === 'fee_pending') throw new ApiError(404, 'Conversation not found');
  return order;
}

async function loadAccess(orderId: number, session: Session) {
  const order = await loadOrder(orderId);
  let party: Party | null = null;
  if (order.buyerId === session.uid) party = 'buyer';
  else if (order.sellerId === session.uid) party = 'seller';
  else if (session.role === 'admin') party = 'admin';
  if (!party) throw new ApiError(404, 'Conversation not found');
  if (party === 'admin') throw new ApiError(403, 'Admins read a chat only through the dispute review, with a reason');
  return { order, party };
}

type Labels = { buyer: string; seller: string };
async function labels(order: typeof orders.$inferSelect): Promise<Labels> {
  const db = await getDb();
  const [b] = await db.select({ name: users.name, society: societies.name }).from(users).leftJoin(societies, eq(users.societyId, societies.id)).where(eq(users.id, order.buyerId));
  const [k] = order.sellerId ? await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, order.sellerId)) : [];
  const first = (b?.name ?? 'Neighbour').trim().split(/\s+/)[0] || 'Neighbour';
  return { buyer: b?.society ? `${first} · ${b.society}` : first, seller: `Kitchen: ${k?.name ?? 'Kitchen'}` };
}

function toMessage(m: typeof orderMessages.$inferSelect, party: Party, l: Labels) {
  return {
    id: m.id,
    from: m.senderRole,
    label: m.senderRole === 'buyer' ? l.buyer : m.senderRole === 'seller' ? l.seller : 'PadosiPlate',
    mine: m.senderRole === party,
    body: m.body,
    imageUrl: m.imageKey ? fileUrl(m.imageKey) : null,
    flags: m.flagsJson ?? [],
    reported: !!m.reportedAt,
    at: m.createdAt,
  };
}

export type ThreadMessage = ReturnType<typeof toMessage>;

/** Weak ETag over what a client can see: used by the polling fallback so an unchanged thread costs a 304. */
export function threadEtag(rows: { id: number; reportedAt: Date | null }[], extra = ''): string {
  const last = rows.length ? rows[rows.length - 1].id : 0;
  const reported = rows.filter((r) => r.reportedAt).length;
  return `W/"t${rows.length}-${last}-${reported}${extra}"`;
}

export async function readThread(orderId: number, session: Session, opts: { markRead?: boolean } = {}) {
  const { order, party } = await loadAccess(orderId, session);
  const db = await getDb();
  const settings = await getPlatformSettings();
  const l = await labels(order);
  const rows = await db.select().from(orderMessages).where(eq(orderMessages.orderId, orderId)).orderBy(asc(orderMessages.createdAt), asc(orderMessages.id));
  if (opts.markRead && rows.length) await markRead(orderId, session.uid, rows[rows.length - 1].id);
  const [otherUser] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, party === 'buyer' ? order.sellerId! : order.buyerId));
  const theirShare = party === 'buyer' ? order.sellerSharePhone : order.buyerSharePhone;
  const mineShare = party === 'buyer' ? order.buyerSharePhone : order.sellerSharePhone;
  return {
    state: threadState(order, new Date(), settings.chatReadOnlyHours),
    viewer: party,
    buyerHandle: l.buyer,
    kitchenLabel: l.seller,
    otherLabel: party === 'buyer' ? l.seller : l.buyer,
    quickReplies: QUICK_REPLIES.filter((q) => q.role === 'both' || q.role === party),
    maxLength: settings.chatMaxLength,
    imagesEnabled: settings.chatImagesEnabled,
    preDoor: ['booked', 'accepted', 'preparing', 'ready', 'on_the_way'].includes(order.status),
    phone: { mine: !!mineShare, theirs: theirShare ? (otherUser?.phone ?? null) : null },
    etag: threadEtag(rows, `-${mineShare ? 1 : 0}${theirShare ? 1 : 0}`),
    messages: rows.map((m) => toMessage(m, party, l)),
  };
}

/** Throws 404/403 unless the session is a participant of this order's chat (used by the stream before it opens). */
export async function assertChatParticipant(orderId: number, session: Session): Promise<void> {
  await loadAccess(orderId, session);
}

/** Messages after `afterId` for the SSE stream and the polling fallback. */
export async function messagesAfter(orderId: number, session: Session, afterId: number) {
  const { order, party } = await loadAccess(orderId, session);
  const db = await getDb();
  const l = await labels(order);
  const rows = await db.select().from(orderMessages).where(and(eq(orderMessages.orderId, orderId), gt(orderMessages.id, Math.min(Math.max(0, Math.trunc(afterId) || 0), 2_147_483_647)))).orderBy(asc(orderMessages.id));
  return rows.map((m) => toMessage(m, party, l));
}

export async function markRead(orderId: number, userId: number, lastId: number) {
  const db = await getDb();
  await db
    .insert(chatReads)
    .values({ orderId, userId, lastReadMessageId: lastId })
    .onConflictDoUpdate({ target: [chatReads.orderId, chatReads.userId], set: { lastReadMessageId: sql`greatest(${chatReads.lastReadMessageId}, ${lastId})`, updatedAt: new Date() } });
}

/** Unread messages from the other side, per order and in total. */
export async function unreadCounts(userId: number): Promise<{ total: number; byOrder: Record<number, number> }> {
  const db = await getDb();
  const rows = await db
    .select({ orderId: orderMessages.orderId, n: sql<number>`count(*)::int` })
    .from(orderMessages)
    .innerJoin(orders, eq(orders.id, orderMessages.orderId))
    .leftJoin(chatReads, and(eq(chatReads.orderId, orderMessages.orderId), eq(chatReads.userId, userId)))
    .where(and(or(eq(orders.buyerId, userId), eq(orders.sellerId, userId)), sql`${orderMessages.senderId} is distinct from ${userId}`, sql`${orderMessages.id} > coalesce(${chatReads.lastReadMessageId}, 0)`, sql`${orders.status} <> 'fee_pending'`))
    .groupBy(orderMessages.orderId);
  const byOrder: Record<number, number> = {};
  let total = 0;
  for (const r of rows) {
    byOrder[r.orderId] = r.n;
    total += r.n;
  }
  return { total, byOrder };
}

export type SendInput = { body?: string; quickReplyKey?: string; imageKey?: string; confirmed?: boolean };
export type SendResult = { sent: true; message: typeof orderMessages.$inferSelect } | { sent: false; warnings: ChatWarning[] };

export async function postMessage(orderId: number, session: Session, input: SendInput): Promise<SendResult> {
  const { order, party } = await loadAccess(orderId, session);
  const settings = await getPlatformSettings();
  const st = threadState(order, new Date(), settings.chatReadOnlyHours);
  if (!st.open) throw new ApiError(409, st.reason ?? 'This conversation is closed');
  const quick = input.quickReplyKey ? QUICK_REPLIES.find((q) => q.key === input.quickReplyKey && (q.role === 'both' || q.role === party)) : undefined;
  if (input.quickReplyKey && !quick) throw new ApiError(400, 'That quick reply is not available');
  const body = (quick?.text ?? input.body ?? '').trim();
  if (!body && !input.imageKey) throw new ApiError(400, 'Write a message or add a photo first');
  if (body.length > settings.chatMaxLength) throw new ApiError(400, `Keep messages under ${settings.chatMaxLength} characters`);

  const db = await getDb();
  if (input.imageKey) {
    if (!settings.chatImagesEnabled) throw new ApiError(400, 'Photos in chat are switched off');
    const [f] = await db.select().from(files).where(eq(files.key, input.imageKey));
    if (!f || f.purpose !== 'chat_image' || f.ownerId !== session.uid) throw new ApiError(400, 'That photo could not be used');
    const [used] = await db.select({ id: orderMessages.id }).from(orderMessages).where(eq(orderMessages.imageKey, input.imageKey));
    if (used) throw new ApiError(400, 'That photo was already sent');
  }

  // Soft filter: warn first, send only on an explicit second tap. Quick replies are ours, so never warned.
  const warnings = quick ? [] : checkOutgoing(body, { badWordsCsv: settings.chatBadWords });
  if (warnings.length && !input.confirmed) return { sent: false, warnings };

  const other = party === 'buyer' ? order.sellerId : order.buyerId;
  if (!other) throw new ApiError(404, 'Conversation not found');
  const [blocked] = await db.select({ id: userBlocks.id }).from(userBlocks).where(and(eq(userBlocks.blockerId, other), eq(userBlocks.blockedId, session.uid)));
  if (blocked) throw new ApiError(403, 'You can no longer message this person');

  const flags = [...new Set(warnings.map((w) => w.kind === 'payment' ? 'payment_request' : w.kind))];
  if (!quick && isPaymentRequest(body) && !flags.includes('payment_request')) flags.push('payment_request');
  const [msg] = await db
    .insert(orderMessages)
    .values({ orderId, senderId: session.uid, senderRole: party, body: body || '📷 Photo', quickReplyKey: quick?.key ?? null, imageKey: input.imageKey ?? null, flagsJson: flags.length ? flags : null })
    .returning();
  await markRead(orderId, session.uid, msg.id);
  await notifyNewMessage(order, party, other, body || 'Photo');
  return { sent: true, message: msg };
}

/** Debounced (one alert per order per person per few minutes), via the notification service. */
async function notifyNewMessage(order: typeof orders.$inferSelect, party: Party, other: number, preview: string) {
  const { emit } = await import('@/lib/notify');
  await emit('chat_message', other, { orderId: order.id, role: party === 'buyer' ? 'seller' : 'buyer', preview });
}

export async function reportMessage(orderId: number, session: Session, messageId: number) {
  const { order, party } = await loadAccess(orderId, session);
  const db = await getDb();
  const [m] = await db.select().from(orderMessages).where(and(eq(orderMessages.id, messageId), eq(orderMessages.orderId, orderId)));
  if (!m) throw new ApiError(404, 'Message not found');
  if (m.senderRole === party) throw new ApiError(400, 'You cannot report your own message');
  if (m.reportedAt) return { grievanceId: null as number | null };
  await db.update(orderMessages).set({ reportedAt: new Date(), reportedById: session.uid }).where(eq(orderMessages.id, messageId));
  const g = await createGrievance({ kind: 'chat_report', orderId, raisedById: session.uid, raisedRole: party === 'seller' ? 'seller' : 'buyer', subject: `Chat report on order #${orderId}`, body: 'A participant flagged a message.', evidence: { messageIds: [messageId], reportedUserId: m.senderId } });
  await notifyAdminsAbout(`Chat reported on order #${orderId}`, `Ticket #${g.id}`);
  await recordAudit({ actorId: session.uid, action: 'thread.report', targetType: 'order', targetId: orderId, meta: { messageId, grievanceId: g.id } });
  return { grievanceId: g.id };
}

/** Report the other person: the ticket carries their recent messages so an admin can judge without reading the whole chat. */
export async function reportUser(orderId: number, session: Session, reason: string) {
  const { order, party } = await loadAccess(orderId, session);
  const other = party === 'buyer' ? order.sellerId! : order.buyerId;
  const db = await getDb();
  const recent = await db.select({ id: orderMessages.id }).from(orderMessages).where(and(eq(orderMessages.orderId, orderId), eq(orderMessages.senderId, other))).orderBy(desc(orderMessages.id)).limit(10);
  const g = await createGrievance({ kind: 'chat_report', orderId, raisedById: session.uid, raisedRole: party === 'seller' ? 'seller' : 'buyer', subject: `User reported from chat on order #${orderId}`, body: reason.slice(0, 1000) || 'No reason given', evidence: { reportedUserId: other, messageIds: recent.map((r) => r.id) } });
  if (recent.length) await db.update(orderMessages).set({ reportedAt: new Date(), reportedById: session.uid }).where(and(inArray(orderMessages.id, recent.map((r) => r.id)), sql`${orderMessages.reportedAt} is null`));
  await notifyAdminsAbout(`User reported on order #${orderId}`, `Ticket #${g.id}`);
  await recordAudit({ actorId: session.uid, action: 'thread.report_user', targetType: 'order', targetId: orderId, meta: { grievanceId: g.id } });
  return { grievanceId: g.id };
}

async function notifyAdminsAbout(title: string, body: string) {
  const { notifyAdmins } = await import('@/lib/orders/strikes');
  await notifyAdmins(title, body, '/admin/grievances');
}

export async function blockOther(orderId: number, session: Session) {
  const { order, party } = await loadAccess(orderId, session);
  const other = party === 'buyer' ? order.sellerId : order.buyerId;
  if (!other) throw new ApiError(404, 'Conversation not found');
  const db = await getDb();
  await db.insert(userBlocks).values({ blockerId: session.uid, blockedId: other }).onConflictDoNothing();
}

/** Per-order “Share my number” switch. The other person sees it in the chat header only while it is on. */
export async function setPhoneShare(orderId: number, session: Session, on: boolean) {
  const { party } = await loadAccess(orderId, session);
  const db = await getDb();
  await db.update(orders).set(party === 'buyer' ? { buyerSharePhone: on } : { sellerSharePhone: on }).where(eq(orders.id, orderId));
}

/** True when the order has a dispute, a chat report or a reported message: the only cases an admin may read the chat. */
export async function adminMayRead(orderId: number): Promise<boolean> {
  const db = await getDb();
  const [g] = await db.select({ id: grievances.id }).from(grievances).where(and(eq(grievances.orderId, orderId), inArray(grievances.kind, ['dispute_payment', 'dispute_food', 'dispute_quality', 'chat_report']))).limit(1);
  if (g) return true;
  const [m] = await db.select({ id: orderMessages.id }).from(orderMessages).where(and(eq(orderMessages.orderId, orderId), sql`${orderMessages.reportedAt} is not null`)).limit(1);
  return !!m;
}

/** Admin read: needs a dispute or report on the order and a written reason; the read is audit-logged. Caller enforces a fresh 2FA check. */
export async function adminReadThread(orderId: number, admin: Session, reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new ApiError(400, 'Say why you are opening this chat (it is logged)');
  const order = await loadOrder(orderId);
  if (!(await adminMayRead(orderId))) throw new ApiError(403, 'Admins can read a chat only when the order has a dispute or a reported message');
  const db = await getDb();
  const l = await labels(order);
  const rows = await db.select().from(orderMessages).where(eq(orderMessages.orderId, orderId)).orderBy(asc(orderMessages.createdAt), asc(orderMessages.id));
  await recordAudit({ actorId: admin.uid, action: 'chat.admin_read', targetType: 'order', targetId: orderId, meta: { reason: why, messages: rows.length } });
  return { buyer: l.buyer, kitchen: l.seller, messages: rows.map((m) => toMessage(m, 'admin', l)) };
}
