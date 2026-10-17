import { and, asc, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { complaints, notifications, orderMessages, orders, sellerProfiles, userBlocks, users } from '@/lib/db/schema';
import { buyerHandle } from '@/lib/handles';
import type { Session } from '@/lib/auth';
import { DAY_MS } from '@/lib/time';

/**
 * Per-order buyer ↔ kitchen messaging, handles only ("Buyer #A7" /
 * "Kitchen: <name>"). No phone numbers, flat numbers or real names are shown.
 * The thread opens when the order is placed and becomes read-only 7 days
 * after the order completes (or is cancelled / expires).
 * WhatsApp relay stays a documented future item.
 */
export const THREAD_READONLY_DAYS = 7;

export const QUICK_REPLIES: { key: string; role: 'buyer' | 'seller' | 'both'; text: string }[] = [
  { key: 'late5', role: 'both', text: 'Running 5 mins late' },
  { key: 'thanks', role: 'buyer', text: 'Food was great, thank you!' },
  { key: 'refund', role: 'buyer', text: "I'd like a refund for…" },
  { key: 'ready', role: 'seller', text: 'Your order is ready 🙂' },
  { key: 'upi_check', role: 'seller', text: 'I could not see your UPI payment yet — could you share the UTR?' },
];

const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'madarchod', 'behenchod', 'chutiya', 'bhosdi', 'randi', 'harami', 'gaandu', 'kutta', 'saala'];
const BAD_RE = new RegExp(`\\b(${BAD_WORDS.join('|')})\\b`, 'i');

/** Basic profanity filter. Returns true if the text should be refused. */
export function hasProfanity(text: string): boolean {
  const normalised = text.toLowerCase().replace(/[@4]/g, 'a').replace(/[1!]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's').replace(/[^a-z\s]/g, ' ');
  return BAD_RE.test(normalised) || BAD_RE.test(text);
}

export function threadState(order: { status: string; completedAt: Date | null; updatedAt: Date }, now: Date = new Date()): { open: boolean; reason?: string } {
  if (order.status === 'expired') return { open: false, reason: 'This order expired.' };
  const ended = ['delivered', 'picked_up', 'cancelled'].includes(order.status);
  if (!ended) return { open: true };
  const endedAt = (order.completedAt ?? order.updatedAt).getTime();
  if (now.getTime() - endedAt > THREAD_READONLY_DAYS * DAY_MS) return { open: false, reason: `Messages close ${THREAD_READONLY_DAYS} days after an order ends.` };
  return { open: true };
}

type Party = 'buyer' | 'seller' | 'admin';

async function loadAccess(orderId: number, session: Session) {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.type !== 'home_delivery' || order.status === 'placed') throw new ApiError(404, 'Conversation not found');
  let party: Party | null = null;
  if (order.buyerId === session.uid) party = 'buyer';
  else if (order.sellerId === session.uid) party = 'seller';
  else if (session.role === 'admin') party = 'admin';
  if (!party) throw new ApiError(404, 'Conversation not found');
  if (party === 'admin') {
    const [c] = await db.select({ id: complaints.id }).from(complaints).where(eq(complaints.orderId, orderId)).limit(1);
    if (!c) throw new ApiError(403, 'Admins can read a conversation only when a complaint exists');
  }
  return { order, party };
}

export async function readThread(orderId: number, session: Session) {
  const { order, party } = await loadAccess(orderId, session);
  const db = await getDb();
  const [kitchen] = order.sellerId ? await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, order.sellerId)) : [];
  const rows = await db.select().from(orderMessages).where(eq(orderMessages.orderId, orderId)).orderBy(asc(orderMessages.createdAt), asc(orderMessages.id));
  if (party === 'admin') await recordAudit({ actorId: session.uid, action: 'thread.read', targetType: 'order', targetId: orderId });
  const me: Party = party;
  return {
    state: threadState(order),
    viewer: me,
    buyerHandle: buyerHandle(orderId, order.buyerId),
    kitchenLabel: `Kitchen: ${kitchen?.name ?? 'Kitchen'}`,
    quickReplies: QUICK_REPLIES.filter((q) => q.role === 'both' || q.role === party),
    messages: rows.map((m) => ({
      id: m.id,
      from: m.senderRole,
      label: m.senderRole === 'buyer' ? buyerHandle(orderId, order.buyerId) : m.senderRole === 'seller' ? `Kitchen: ${kitchen?.name ?? 'Kitchen'}` : 'PadosiPlate',
      mine: m.senderRole === party,
      body: m.body,
      reported: !!m.reportedAt,
      at: m.createdAt,
    })),
  };
}

export async function postMessage(orderId: number, session: Session, input: { body?: string; quickReplyKey?: string }) {
  const { order, party } = await loadAccess(orderId, session);
  if (party === 'admin') throw new ApiError(403, 'Admins read conversations only');
  const st = threadState(order);
  if (!st.open) throw new ApiError(409, st.reason ?? 'This conversation is closed');
  const quick = input.quickReplyKey ? QUICK_REPLIES.find((q) => q.key === input.quickReplyKey && (q.role === 'both' || q.role === party)) : undefined;
  const body = (quick?.text ?? input.body ?? '').trim();
  if (!body) throw new ApiError(400, 'Write a message first');
  if (body.length > 500) throw new ApiError(400, 'Keep messages under 500 characters');
  if (hasProfanity(body)) throw new ApiError(400, 'Please keep it polite — that message was not sent');
  // Phone numbers / links would defeat the masking.
  if (/(\+?\d[\s-]?){9,}/.test(body) || /https?:\/\/|www\./i.test(body)) throw new ApiError(400, 'For privacy, phone numbers and links cannot be shared here');

  const other = party === 'buyer' ? order.sellerId : order.buyerId;
  if (!other) throw new ApiError(404, 'Conversation not found');
  const db = await getDb();
  const [blocked] = await db.select({ id: userBlocks.id }).from(userBlocks).where(and(eq(userBlocks.blockerId, other), eq(userBlocks.blockedId, session.uid)));
  if (blocked) throw new ApiError(403, 'You can no longer message this person');

  const [msg] = await db.insert(orderMessages).values({ orderId, senderId: session.uid, senderRole: party, body, quickReplyKey: quick?.key ?? null }).returning();
  const href = `/orders/${orderId}#messages`;
  const [unread] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, other), eq(notifications.href, href)));
  if (!unread) await notify(other, party === 'buyer' ? `New message on order #${orderId}` : `Message from ${(await kitchenName(order.sellerId))} (order #${orderId})`, body.slice(0, 100), party === 'buyer' ? '/seller/orders' : href);
  return msg;
}

async function kitchenName(sellerId: number | null) {
  if (!sellerId) return 'the kitchen';
  const db = await getDb();
  const [k] = await db.select({ n: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  return k?.n ?? 'the kitchen';
}

export async function reportMessage(orderId: number, session: Session, messageId: number) {
  const { party } = await loadAccess(orderId, session);
  if (party === 'admin') throw new ApiError(403, 'Not applicable');
  const db = await getDb();
  const [m] = await db.update(orderMessages).set({ reportedAt: new Date(), reportedById: session.uid }).where(and(eq(orderMessages.id, messageId), eq(orderMessages.orderId, orderId))).returning();
  if (!m) throw new ApiError(404, 'Message not found');
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  for (const a of admins) await notify(a.id, `Message reported on order #${orderId}`, 'A participant flagged a message.', '/admin/complaints');
  await recordAudit({ actorId: session.uid, action: 'thread.report', targetType: 'order', targetId: orderId, meta: { messageId } });
}

export async function blockOther(orderId: number, session: Session) {
  const { order, party } = await loadAccess(orderId, session);
  if (party === 'admin') throw new ApiError(403, 'Not applicable');
  const other = party === 'buyer' ? order.sellerId : order.buyerId;
  if (!other) throw new ApiError(404, 'Conversation not found');
  const db = await getDb();
  await db.insert(userBlocks).values({ blockerId: session.uid, blockedId: other }).onConflictDoNothing();
}
