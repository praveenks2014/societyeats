import { and, asc, eq, inArray } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { grievances, orderEvents, orderItems, orders, referralCredits, sellerProfiles, societies, users } from '@/lib/db/schema';
import { acknowledgeGrievance, resolveGrievance } from '@/lib/grievances';
import { performOrderAction } from '@/lib/orders/actions';
import { refundOrderPayment } from '@/lib/payments/refunds';
import { emit } from '@/lib/notify';
import { adminMayRead } from '@/lib/messaging/order-thread';
import { DAY_MS } from '@/lib/time';

export const DISPUTE_KINDS = ['dispute_payment', 'dispute_food', 'dispute_quality', 'chat_report'] as const;

/** Board columns: where each order is right now, so an admin sees what is stuck. */
export const BOARD_COLUMNS: { key: string; label: string; states: string[] }[] = [
  { key: 'booked', label: 'Waiting for the kitchen', states: ['booked', 'paid'] },
  { key: 'cooking', label: 'Cooking / on the way', states: ['accepted', 'preparing', 'ready', 'on_the_way'] },
  { key: 'door', label: 'At the door', states: ['at_door'] },
  { key: 'payment', label: 'Payment being confirmed', states: ['collected', 'payment_claimed'] },
  { key: 'disputed', label: 'Disputed', states: ['payment_disputed'] },
  { key: 'closed_unpaid', label: 'Closed unpaid', states: ['closed_unpaid', 'no_show_buyer', 'cancelled_buyer_unpaid'] },
];

export type Sla = { ackOverdue: boolean; resolveOverdue: boolean; ackHoursLeft: number | null; resolveHoursLeft: number | null };
export function slaOf(g: { status: string; ackDueAt: Date; resolveDueAt: Date }, now: Date = new Date()): Sla {
  const open = g.status === 'open' || g.status === 'acknowledged';
  const ackPending = g.status === 'open';
  return {
    ackOverdue: ackPending && g.ackDueAt.getTime() < now.getTime(),
    resolveOverdue: open && g.resolveDueAt.getTime() < now.getTime(),
    ackHoursLeft: ackPending ? Math.round((g.ackDueAt.getTime() - now.getTime()) / 3_600_000) : null,
    resolveHoursLeft: open ? Math.round((g.resolveDueAt.getTime() - now.getTime()) / 3_600_000) : null,
  };
}

export async function disputeBoard(filter: { societyId?: number; sellerId?: number } = {}, now: Date = new Date()) {
  const db = await getDb();
  const allStates = BOARD_COLUMNS.flatMap((c) => c.states);
  const rows = await db
    .select({ o: orders, kitchen: sellerProfiles.kitchenName, societyId: users.societyId })
    .from(orders)
    .leftJoin(sellerProfiles, eq(orders.sellerId, sellerProfiles.userId))
    .innerJoin(users, eq(users.id, orders.buyerId))
    .where(and(inArray(orders.status, allStates as never), filter.sellerId ? eq(orders.sellerId, filter.sellerId) : undefined))
    .orderBy(asc(orders.updatedAt))
    .limit(300);
  const filtered = filter.societyId ? rows.filter((r) => r.societyId === filter.societyId) : rows;
  const columns = BOARD_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    orders: filtered.filter((r) => c.states.includes(r.o.status)).map((r) => ({ id: r.o.id, status: r.o.status, kitchen: r.kitchen ?? '—', foodPaise: r.o.foodTotalInPaise, minutesInState: Math.round((now.getTime() - r.o.updatedAt.getTime()) / 60_000) })),
  }));

  const tickets = await db.select().from(grievances).where(and(inArray(grievances.kind, [...DISPUTE_KINDS]), inArray(grievances.status, ['open', 'acknowledged']))).orderBy(asc(grievances.resolveDueAt));
  const settings = await getPlatformSettings();
  return {
    columns,
    tickets: tickets.map((g) => ({ id: g.id, kind: g.kind, orderId: g.orderId, subject: g.subject, status: g.status, createdAt: g.createdAt, ackDueAt: g.ackDueAt, resolveDueAt: g.resolveDueAt, ...slaOf(g, now) })),
    overdue: tickets.filter((g) => { const s = slaOf(g, now); return s.ackOverdue || s.resolveOverdue; }).length,
    targets: { ackHours: settings.grievanceAckHours, resolveDays: settings.grievanceResolveDays },
  };
}

export async function disputeDetail(grievanceId: number, now: Date = new Date()) {
  const db = await getDb();
  const [g] = await db.select().from(grievances).where(eq(grievances.id, grievanceId));
  if (!g) throw new ApiError(404, 'Ticket not found');
  let order = null as null | Record<string, unknown>;
  let timeline: { status: string; note: string | null; at: Date }[] = [];
  if (g.orderId) {
    const [o] = await db.select().from(orders).where(eq(orders.id, g.orderId));
    if (o) {
      const [buyer] = await db.select({ name: users.name, society: societies.name }).from(users).leftJoin(societies, eq(users.societyId, societies.id)).where(eq(users.id, o.buyerId));
      const [kitchen] = o.sellerId ? await db.select({ name: sellerProfiles.kitchenName, upi: sellerProfiles.upiVpa }).from(sellerProfiles).where(eq(sellerProfiles.userId, o.sellerId)) : [];
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
      order = {
        id: o.id, status: o.status, buyerId: o.buyerId, sellerId: o.sellerId, buyer: buyer?.name, buyerSociety: buyer?.society, kitchen: kitchen?.name, kitchenUpi: kitchen?.upi,
        foodPaise: o.foodTotalInPaise, feePaise: o.onlineChargeInPaise, feeRefundedPaise: o.feeRefundedInPaise, creditIssuedPaise: o.creditIssuedInPaise,
        items: items.map((i) => `${i.titleSnapshot} × ${i.qty}`),
        // both statements: what the buyer claimed, and what the kitchen said
        buyerClaim: { method: o.foodPaymentMethod, utr: o.foodPaymentUtr, claimedAt: o.foodPaymentClaimedAt },
        kitchenStatement: g.body,
      };
      timeline = (await db.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(asc(orderEvents.createdAt), asc(orderEvents.id))).map((e) => ({ status: e.status, note: e.note, at: e.createdAt }));
    }
  }
  return { ticket: { ...g, ...slaOf(g, now) }, order, timeline, chatMayRead: g.orderId ? await adminMayRead(g.orderId) : false };
}

export type Outcome =
  | { kind: 'mark_paid' }
  | { kind: 'mark_unpaid' }
  | { kind: 'refund_fee' }
  | { kind: 'issue_credit'; amountPaise: number }
  | { kind: 'warn'; target: 'buyer' | 'seller'; message: string }
  | { kind: 'suspend'; target: 'buyer' | 'seller'; days?: number };

/**
 * An admin's decision on a dispute ticket. Every outcome records a note, notifies the people it touches, writes the audit log and
 * (except a bare warning) closes the ticket. The money outcomes reuse the same exactly-once paths as the order flow.
 */
export async function applyOutcome(grievanceId: number, outcome: Outcome, note: string, adminId: number) {
  const why = note.trim();
  if (why.length < 3) throw new ApiError(400, 'Write a short note for the record');
  const db = await getDb();
  const [g] = await db.select().from(grievances).where(eq(grievances.id, grievanceId));
  if (!g) throw new ApiError(404, 'Ticket not found');
  if (g.status === 'resolved' || g.status === 'closed') throw new ApiError(409, 'This ticket is already resolved');
  const [order] = g.orderId ? await db.select().from(orders).where(eq(orders.id, g.orderId)) : [];
  const settings = await getPlatformSettings();
  if (g.status === 'open') await acknowledgeGrievance(grievanceId, adminId);
  let resolution: string = outcome.kind;
  let closes = true;

  switch (outcome.kind) {
    case 'mark_paid':
      if (!order) throw new ApiError(400, 'This ticket is not about an order');
      if (order.status !== 'payment_disputed') throw new ApiError(409, 'The order is not in dispute any more');
      await performOrderAction(order.id, { action: 'resolve_paid', actor: 'admin', actorId: adminId, reason: why });
      break;
    case 'mark_unpaid':
      if (!order) throw new ApiError(400, 'This ticket is not about an order');
      if (order.status !== 'payment_disputed') throw new ApiError(409, 'The order is not in dispute any more');
      await performOrderAction(order.id, { action: 'resolve_unpaid', actor: 'admin', actorId: adminId, reason: why }); // also records the buyer strike
      break;
    case 'refund_fee': {
      if (!order) throw new ApiError(400, 'This ticket is not about an order');
      if (order.feeRefundedInPaise >= order.onlineChargeInPaise) throw new ApiError(409, 'The platform fee was already refunded');
      const r = await refundOrderPayment({ orderId: order.id, reason: why, initiatedBy: `admin:${adminId}` });
      await db.update(orders).set({ feeRefundedInPaise: r.amountInPaise }).where(eq(orders.id, order.id));
      await emit('refund_issued', order.buyerId, { orderId: order.id, refundPaise: r.amountInPaise });
      break;
    }
    case 'issue_credit': {
      if (!order) throw new ApiError(400, 'This ticket is not about an order');
      if (!Number.isInteger(outcome.amountPaise) || outcome.amountPaise <= 0 || outcome.amountPaise > settings.buyerPlatformFeeMaxPaise * 4) throw new ApiError(400, 'Enter a sensible credit amount');
      await db.insert(referralCredits).values({ buyerId: order.buyerId, source: 'admin', sourceOrderId: order.id, amountInPaise: outcome.amountPaise, note: `Goodwill credit after ticket #${grievanceId}` });
      await db.update(orders).set({ creditIssuedInPaise: order.creditIssuedInPaise + outcome.amountPaise }).where(eq(orders.id, order.id));
      await emit('credit_issued', order.buyerId, { orderId: order.id, creditPaise: outcome.amountPaise });
      break;
    }
    case 'warn': {
      if (!order && !g.raisedById) throw new ApiError(400, 'Nobody to warn');
      const userId = outcome.target === 'buyer' ? order?.buyerId : order?.sellerId;
      if (!userId) throw new ApiError(400, 'That person is not on this order');
      const { notify } = await import('@/lib/db/notify');
      await notify(userId, 'A warning from PadosiPlate', outcome.message.trim().slice(0, 400) || why, outcome.target === 'seller' ? '/seller' : '/orders');
      closes = false;
      resolution = `warn_${outcome.target}`;
      break;
    }
    case 'suspend': {
      const userId = outcome.target === 'buyer' ? order?.buyerId : order?.sellerId;
      if (!userId) throw new ApiError(400, 'That person is not on this order');
      if (outcome.target === 'buyer') {
        const until = new Date(Date.now() + (outcome.days ?? settings.buyerBlockDays) * DAY_MS);
        await db.update(users).set({ ordersBlockedUntil: until }).where(eq(users.id, userId));
        await emit('strike_issued', userId, { role: 'buyer', reason: `Ordering paused until ${until.toDateString()} after ticket #${grievanceId}`, count: 1, limit: 1 });
      } else {
        await db.update(sellerProfiles).set({ listingsPausedReason: 'dispute', listingsPausedAt: new Date() }).where(eq(sellerProfiles.userId, userId));
        await emit('listing_paused', userId, { reason: `PadosiPlate paused your kitchen after ticket #${grievanceId}: ${why}` });
      }
      resolution = `suspend_${outcome.target}`;
      break;
    }
  }
  await recordAudit({ actorId: adminId, action: `dispute.${outcome.kind}`, targetType: 'grievance', targetId: grievanceId, meta: { orderId: g.orderId, note: why, ...('amountPaise' in outcome ? { amountPaise: outcome.amountPaise } : {}), ...('target' in outcome ? { target: outcome.target } : {}) } });
  if (closes) await resolveGrievance(grievanceId, adminId, resolution.slice(0, 30), why);
  return { resolved: closes };
}
