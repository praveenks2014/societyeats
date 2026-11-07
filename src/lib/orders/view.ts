import type { orders } from '@/lib/db/schema';
import { ADDRESS_VISIBLE_STATES, canTransition, type Actor, type OrderAction, type OrderStatus } from './state';

type Order = typeof orders.$inferSelect;
export type Viewer = { uid: number; role: 'buyer' | 'seller' | 'restaurant' | 'admin' };

const DAY_AFTER_COMPLETION_MS = 24 * 60 * 60 * 1000;

export function viewerActor(order: Pick<Order, 'buyerId' | 'sellerId'>, v: Viewer): Actor | null {
  if (v.role === 'admin') return 'admin';
  if (order.buyerId === v.uid) return 'buyer';
  if (order.sellerId === v.uid) return 'seller';
  return null;
}

/**
 * The ONLY way an order row leaves the server. Whitelisting by deletion of the sensitive fields keeps this
 * auditable and testable (see tests/unit/redaction.test.ts):
 *  - the kitchen's UPI ID and registered name are never part of the row; the buyer gets them via `revealUpi`
 *    only once the order is at the door (or later);
 *  - the flat / delivery address reaches the kitchen only after it accepts, and is hidden again 24 hours after completion;
 *  - the legacy OTP is a Mall-flow concept, never shown to a kitchen.
 */
export function redactOrder(order: Order, v: Viewer, now: Date = new Date()): Omit<Order, 'sellerVpaSnapshot' | 'sellerRegisteredNameSnapshot'> & { sellerVpaSnapshot?: string | null; sellerRegisteredNameSnapshot?: string | null } {
  const actor = viewerActor(order, v);
  const out: Record<string, unknown> = { ...order };
  if (actor !== 'admin') {
    delete out.sellerVpaSnapshot;
    delete out.sellerRegisteredNameSnapshot;
  }
  if (actor === 'seller') {
    delete out.otpCode;
    const visible = ADDRESS_VISIBLE_STATES.includes(order.status) && (!order.completedAt || now.getTime() - order.completedAt.getTime() < DAY_AFTER_COMPLETION_MS);
    if (!visible) out.deliveryAddressJson = null;
  }
  if (actor === 'buyer' && order.type === 'home_delivery') delete out.otpCode;
  return out as never;
}

/** What the viewer can do on this order right now (drives the buttons; the server re-checks every action). */
export function allowedActions(order: Order, v: Viewer, opts: { atDoorWaitMinutes: number; kitchenAcceptsCash?: boolean }, now: Date = new Date()): OrderAction[] {
  const actor = viewerActor(order, v);
  if (!actor || order.type !== 'home_delivery') return [];
  const candidates: OrderAction[] = actor === 'buyer'
    ? ['buyer_cancel', 'collect', 'claim_paid']
    : ['accept', 'preparing', 'ready', 'on_the_way', 'reached_door', 'buyer_arrived', 'confirm_paid', 'not_received', 'raise_dispute', 'buyer_couldnt_pay', 'no_show', 'seller_cancel', ...(actor === 'admin' ? (['resolve_paid', 'resolve_unpaid', 'admin_cancel'] as OrderAction[]) : [])];
  return candidates.filter((a) => {
    if (!canTransition(order.status as OrderStatus, a, actor)) return false;
    if ((a === 'on_the_way' || a === 'reached_door') && order.fulfillmentType !== 'seller_delivery') return false;
    if (a === 'buyer_arrived' && order.fulfillmentType !== 'self_pickup') return false;
    if (a === 'no_show') return !!order.atDoorAt && now.getTime() - order.atDoorAt.getTime() >= opts.atDoorWaitMinutes * 60_000;
    return true;
  });
}
