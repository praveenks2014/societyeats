import { and, eq, inArray } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { notifyUser } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { grievances, orderEvents, orders, referralCredits, sellerProfiles } from '@/lib/db/schema';
import { createGrievance } from '@/lib/grievances';
import { kitchenGate } from '@/lib/kitchen/gate';
import { log } from '@/lib/log';
import { formatINR } from '@/lib/money';
import { refundOrderPayment } from '@/lib/payments/refunds';
import { maybeGrantReferralCredit, releaseCredit } from '@/lib/referrals';
import { releaseStock } from './stock';
import {
  cancelPolicy,
  nextOrderStatus,
  QR_REVEAL_STATES,
  type Actor,
  type CancelKind,
  type OrderAction,
  type OrderStatus,
} from './state';
import { recordStrike, notifyAdmins, maybeNudgeDeclines } from './strikes';
import { checkTdsThresholds } from './tds';

export type ActionInput = {
  action: OrderAction;
  actor: Actor;
  /** The acting user's id (null for the system). Ownership is verified against the order. */
  actorId: number | null;
  /** Free text: cancellation reason, dispute note. */
  reason?: string;
  /** claim_paid: how the buyer paid, and an optional 12-digit UTR. */
  method?: 'upi' | 'cash';
  utr?: string;
  /** admin_cancel: also issue the equal-value credit. */
  credit?: boolean;
  now?: Date;
};

export type ActionResult = {
  status: OrderStatus;
  refundedFeePaise: number;
  creditIssuedPaise: number;
  refundFailed: boolean;
  strike: boolean;
};

export const UTR_RE = /^\d{12}$/;

const EVENT_NOTE: Partial<Record<OrderAction, string>> = {
  accept: 'Order accepted by the kitchen',
  preparing: 'Cooking started',
  ready: 'Packed and ready',
  on_the_way: 'Kitchen is on the way',
  reached_door: 'Kitchen reached your door',
  buyer_arrived: 'Buyer arrived at the kitchen',
  collect: 'Buyer collected the food',
};

/**
 * THE one place an order moves. Checks that `actorId` really is that actor on this order, runs the
 * transition as a conditional UPDATE (so each transition happens exactly once even if two requests race),
 * writes the timeline event, and applies the money and strike consequences of cancellations.
 */
export async function performOrderAction(orderId: number, input: ActionInput): Promise<ActionResult> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const now = input.now ?? new Date();
  const [existing] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!existing || existing.type !== 'home_delivery') throw new ApiError(404, 'Order not found');

  // ---- who is acting ----
  if (input.actor === 'buyer' && existing.buyerId !== input.actorId) throw new ApiError(403, 'Not your order');
  if (input.actor === 'seller' && existing.sellerId !== input.actorId) throw new ApiError(403, 'Not your order');
  if (input.actor === 'restaurant') throw new ApiError(403, 'Not available for this order');

  const action = input.action;
  const to = nextOrderStatus(existing.status, action, input.actor);

  // ---- action-specific preconditions ----
  if (action === 'on_the_way' || action === 'reached_door') {
    if (existing.fulfillmentType !== 'seller_delivery') throw new ApiError(400, 'This order is for pickup — use "Buyer has arrived"');
  }
  if (action === 'buyer_arrived' && existing.fulfillmentType !== 'self_pickup') throw new ApiError(400, 'This order is a delivery — use "On the way"');
  if (action === 'accept' && input.actor !== 'admin') {
    const gate = await kitchenGate(existing.sellerId!, now);
    if (!gate.ok) throw new ApiError(403, `You can't accept new orders right now: ${gate.reasons.join('; ')}`);
  }
  if (action === 'no_show') {
    const waitMs = settings.atDoorWaitMinutes * 60_000;
    if (!existing.atDoorAt || now.getTime() - existing.atDoorAt.getTime() < waitMs) {
      throw new ApiError(409, `Please wait ${settings.atDoorWaitMinutes} minutes at the door before recording a no-show`);
    }
  }
  const reasonNeeded = ['seller_cancel', 'buyer_couldnt_pay', 'no_show', 'not_received', 'raise_dispute', 'admin_cancel', 'resolve_unpaid'].includes(action);
  const reason = (input.reason ?? '').trim();
  if (reasonNeeded && reason.length < 3 && !(action === 'buyer_couldnt_pay')) throw new ApiError(400, 'Please give a short reason');
  if (action === 'claim_paid') {
    if (input.utr && !UTR_RE.test(input.utr)) throw new ApiError(400, 'A UPI reference (UTR) is 12 digits');
    if (!input.method || !['upi', 'cash'].includes(input.method)) throw new ApiError(400, 'Choose how you paid');
    if (input.method === 'cash') {
      const [p] = await db.select({ c: sellerProfiles.acceptsCash }).from(sellerProfiles).where(eq(sellerProfiles.userId, existing.sellerId!));
      if (!p?.c) throw new ApiError(400, 'This kitchen does not take cash — pay by UPI');
    }
  }

  // ---- policy for cancellations ----
  let cancelKind: CancelKind | null = null;
  if (action === 'seller_cancel') cancelKind = existing.status === 'booked' || existing.status === 'paid' ? 'seller_decline' : 'seller_cancel';
  else if (action === 'buyer_cancel') cancelKind = existing.status === 'booked' ? 'buyer_before_accept' : 'buyer_after_accept';
  else if (action === 'auto_cancel') cancelKind = 'auto_no_accept';
  else if (action === 'buyer_couldnt_pay') cancelKind = 'buyer_couldnt_pay';
  else if (action === 'no_show') cancelKind = 'buyer_no_show';
  else if (action === 'admin_cancel') cancelKind = 'admin';
  const policy = cancelKind ? cancelPolicy(cancelKind, { feeRetainedOnLateBuyerCancel: settings.buyerLateCancelFeeRetained }) : null;
  const preDoor = ['booked', 'accepted', 'preparing', 'ready', 'on_the_way', 'paid'].includes(existing.status);

  // ---- the transition (exactly once) ----
  const patch: Partial<typeof orders.$inferInsert> = { status: to, updatedAt: now };
  switch (action) {
    case 'accept': patch.acceptedAt = now; patch.acceptBy = null; break;
    case 'ready': patch.readyAt = now; break;
    case 'on_the_way': patch.onTheWayAt = now; break;
    case 'reached_door':
    case 'buyer_arrived': patch.atDoorAt = now; break;
    case 'collect': patch.collectedAt = now; break;
    case 'claim_paid':
      patch.foodPaymentStatus = 'buyer_claimed';
      patch.foodPaymentClaimedAt = now;
      patch.foodPaymentUtr = input.utr || null;
      patch.foodPaymentMethod = input.method;
      break;
    case 'confirm_paid':
    case 'auto_complete':
    case 'resolve_paid':
      patch.foodPaymentStatus = action === 'auto_complete' ? 'auto_confirmed' : 'confirmed';
      patch.foodPaymentConfirmedAt = now;
      patch.completedAt = now;
      patch.autoCompleted = action === 'auto_complete';
      break;
    case 'not_received':
    case 'raise_dispute': patch.foodPaymentStatus = 'not_received'; break;
    case 'resolve_unpaid': patch.foodPaymentStatus = 'unpaid'; patch.completedAt = now; break;
    default: break;
  }
  if (policy) {
    patch.cancelledAt = now;
    patch.cancelledBy = input.actor === 'system' ? 'system' : input.actor;
    patch.cancelReason = reason || defaultCancelReason(cancelKind!);
  }

  const moved = await db.transaction(async (tx) => {
    const [o] = await tx.update(orders).set(patch).where(and(eq(orders.id, orderId), eq(orders.status, existing.status))).returning();
    if (!o) return null;
    if (policy && preDoor) await releaseStock(tx, orderId);
    await tx.insert(orderEvents).values({ orderId, status: to, note: eventNote(action, reason, input, existing.foodTotalInPaise) });
    return o;
  });
  if (!moved) throw new ApiError(409, 'This order was just updated — refresh and try again');

  const result: ActionResult = { status: to, refundedFeePaise: 0, creditIssuedPaise: 0, refundFailed: false, strike: false };

  // ---- money and strikes for cancellations ----
  if (policy) {
    if (policy.refundFee && moved.onlineChargeInPaise > 0) {
      try {
        const r = await refundOrderPayment({ orderId, reason: moved.cancelReason ?? 'Order cancelled', initiatedBy: input.actor === 'admin' ? `admin:${input.actorId}` : 'system' });
        result.refundedFeePaise = r.amountInPaise;
        await db.update(orders).set({ feeRefundedInPaise: r.amountInPaise }).where(eq(orders.id, orderId));
        await db.transaction(async (tx) => {
          await releaseCredit(tx, orderId);
        });
      } catch (e) {
        result.refundFailed = true;
        log.error('order.cancel_refund_failed', { orderId, err: e });
        await notifyAdmins('Fee refund failed', `Order #${orderId}: the platform-fee refund did not go through. Retry from Refunds.`, '/admin/refunds');
      }
    } else if (policy.refundFee) {
      // Nothing was charged (credit covered it): hand any reserved credit back.
      await db.transaction(async (tx) => {
        await releaseCredit(tx, orderId);
      });
    }
    // Equal-value credit, platform-funded: a kitchen that cancels must make the buyer whole, not just refund the fee.
    const creditWanted = policy.credit || (action === 'admin_cancel' && input.credit);
    if (creditWanted && result.refundedFeePaise > 0) {
      await db.insert(referralCredits).values({ buyerId: moved.buyerId, source: action === 'admin_cancel' ? 'admin' : 'seller_cancel', sourceOrderId: orderId, amountInPaise: result.refundedFeePaise, note: `Credit for cancelled order #${orderId}` });
      result.creditIssuedPaise = result.refundedFeePaise;
      await db.update(orders).set({ creditIssuedInPaise: result.refundedFeePaise }).where(eq(orders.id, orderId));
    }
    if (cancelKind === 'seller_decline') await maybeNudgeDeclines(moved.sellerId!, now);
    if (policy.strike) {
      const userId = policy.strike.role === 'seller' ? moved.sellerId! : moved.buyerId;
      result.strike = await recordStrike({ userId, role: policy.strike.role, kind: policy.strike.kind, orderId, reason: moved.cancelReason ?? undefined }, now);
    }
  }

  await afterTransition(moved, action, input, result);
  return result;
}

function defaultCancelReason(k: CancelKind): string {
  switch (k) {
    case 'auto_no_accept': return 'Kitchen did not respond in time';
    case 'buyer_couldnt_pay': return "Buyer couldn't pay at the door";
    case 'buyer_no_show': return 'Buyer was not at the door';
    case 'buyer_before_accept':
    case 'buyer_after_accept': return 'Cancelled by the buyer';
    case 'admin': return 'Cancelled by PadosiPlate';
    default: return 'Cancelled by the kitchen';
  }
}

function eventNote(action: OrderAction, reason: string, input: ActionInput, foodPaise: number): string {
  switch (action) {
    case 'claim_paid': return `Buyer says they paid ${formatINR(foodPaise)} by ${input.method === 'cash' ? 'cash' : 'UPI'}${input.utr ? ` (UTR ${input.utr})` : ''}`;
    case 'confirm_paid': return 'Kitchen confirmed it received the payment';
    case 'auto_complete': return 'Completed automatically — the kitchen did not dispute the payment in time';
    case 'not_received': return `Kitchen says the payment was not received${reason ? `: ${reason}` : ''}`;
    case 'raise_dispute': return `Kitchen raised a payment dispute${reason ? `: ${reason}` : ''}`;
    case 'resolve_paid': return 'PadosiPlate marked the food as paid';
    case 'resolve_unpaid': return `PadosiPlate closed the order as unpaid${reason ? `: ${reason}` : ''}`;
    case 'seller_cancel': return `Cancelled by the kitchen${reason ? `: ${reason}` : ''} — platform fee refunded`;
    case 'buyer_cancel': return 'Cancelled by the buyer';
    case 'auto_cancel': return 'Kitchen did not respond — order cancelled, platform fee refunded';
    case 'buyer_couldnt_pay': return "Kitchen recorded: buyer couldn't pay at the door";
    case 'no_show': return 'Kitchen recorded: buyer did not come to the door';
    case 'admin_cancel': return `Cancelled by PadosiPlate${reason ? `: ${reason}` : ''}`;
    default: return EVENT_NOTE[action] ?? action.replaceAll('_', ' ');
  }
}

/** Notifications and follow-ups once a transition is committed. */
async function afterTransition(order: typeof orders.$inferSelect, action: OrderAction, input: ActionInput, result: ActionResult) {
  const db = await getDb();
  const id = order.id;
  const buyer = (title: string, body: string, email = false) => notifyUser(order.buyerId, title, body, `/orders/${id}`, { email, emailKind: 'order' });
  const seller = (title: string, body: string, email = false) => (order.sellerId ? notifyUser(order.sellerId, title, body, '/seller/orders', { email, emailKind: 'order' }) : Promise.resolve());

  switch (action) {
    case 'accept': await buyer(`Order #${id} accepted ✅`, 'The kitchen has started on your order.', true); break;
    case 'preparing': break;
    case 'ready':
      await buyer(order.fulfillmentType === 'self_pickup' ? 'Order ready for pickup 🔔' : 'Order ready 🔔', order.fulfillmentType === 'self_pickup' ? `Your order #${id} is ready — head to the kitchen.` : `Order #${id} is ready and will be on its way shortly.`);
      break;
    case 'on_the_way': await buyer('Your order is on the way 🛵', `The kitchen is bringing order #${id}. Pay for the food only after it reaches you.`, true); break;
    case 'reached_door':
    case 'buyer_arrived':
      await buyer(action === 'reached_door' ? 'The kitchen is at your door 🚪' : 'Collect your order', `Pay ${formatINR(order.foodTotalInPaise)} to the kitchen by UPI once you have the food. Open the order to see the QR.`, true);
      break;
    case 'collect': await seller(`Order #${id}: buyer has the food`, 'They will now pay you. Confirm when the money arrives.'); break;
    case 'claim_paid': await seller(`Order #${id}: confirm payment`, `The buyer says they paid ${formatINR(order.foodTotalInPaise)}${order.foodPaymentUtr ? ` — UTR ${order.foodPaymentUtr}` : ''}. Check your UPI app, then confirm.`, true); break;
    case 'confirm_paid':
    case 'auto_complete':
    case 'resolve_paid':
      await buyer(`Order #${id} complete 🎉`, 'Thanks! Tell your neighbours — and rate the kitchen.');
      await maybeGrantReferralCredit({ id, buyerId: order.buyerId });
      if (order.sellerId) await checkTdsThresholds(order.sellerId);
      break;
    case 'not_received':
    case 'raise_dispute': {
      await createGrievance({ kind: 'dispute_payment', orderId: id, raisedById: input.actorId, raisedRole: 'seller', subject: `Order #${id}: kitchen says payment not received`, body: input.reason, evidence: { utr: order.foodPaymentUtr, method: order.foodPaymentMethod, foodPaise: order.foodTotalInPaise } });
      await buyer(`Order #${id}: payment not found`, 'The kitchen could not find your payment. PadosiPlate will look into it — please keep your UPI receipt.', true);
      await notifyAdmins(`Payment dispute — order #${id}`, 'Kitchen says the food payment was not received.', '/admin/disputes');
      break;
    }
    case 'resolve_unpaid':
      await buyer(`Order #${id} closed`, 'PadosiPlate could not confirm payment for this order. Contact Help if you think this is wrong.', true);
      await seller(`Order #${id} closed as unpaid`, 'PadosiPlate reviewed the dispute and recorded the order as unpaid.');
      await recordStrike({ userId: order.buyerId, role: 'buyer', kind: 'buyer_unpaid', orderId: id, reason: 'Order closed as unpaid after a dispute' });
      await db.update(grievances).set({ status: 'resolved', resolution: 'unpaid', resolvedAt: new Date() }).where(and(eq(grievances.orderId, id), inArray(grievances.status, ['open', 'acknowledged'])));
      break;
    case 'seller_cancel':
      await buyer(`Order #${id} cancelled by the kitchen`, `We're sorry. Your platform fee${result.refundedFeePaise ? ` of ${formatINR(result.refundedFeePaise)}` : ''} is being refunded${result.creditIssuedPaise ? ` and ${formatINR(result.creditIssuedPaise)} PadosiPlate credit has been added for your next order` : ''}.`, true);
      break;
    case 'buyer_cancel':
      await seller(`Order #${id} cancelled by the buyer`, 'The buyer cancelled this order.');
      await buyer(`Order #${id} cancelled`, result.refundedFeePaise ? 'Your platform fee is being refunded.' : 'The platform fee is not refunded after the kitchen has accepted.');
      break;
    case 'auto_cancel':
      await buyer(`Order #${id} was not accepted`, 'The kitchen did not respond in time. Your platform fee is being refunded.', true);
      await seller(`Order #${id} auto-cancelled`, 'You did not accept in time.');
      break;
    case 'buyer_couldnt_pay':
    case 'no_show':
      await buyer(`Order #${id} closed`, action === 'no_show' ? 'The kitchen waited at the door and could not reach you. The platform fee is not refunded.' : "The food was not paid for at the door, so the order was cancelled. The platform fee is not refunded.", true);
      await notifyAdmins(`Order #${id}: ${action === 'no_show' ? 'buyer no-show' : "buyer couldn't pay"}`, 'Food was prepared and not paid for.', '/admin/orders');
      break;
    case 'admin_cancel':
      await buyer(`Order #${id} cancelled by PadosiPlate`, 'Your platform fee is being refunded.', true);
      await seller(`Order #${id} cancelled by PadosiPlate`, input.reason ?? 'Cancelled by PadosiPlate.');
      break;
    default: break;
  }
}

/** True once the buyer may see the kitchen's UPI ID, registered name and QR. */
export const mayRevealQr = (status: OrderStatus) => QR_REVEAL_STATES.includes(status);
