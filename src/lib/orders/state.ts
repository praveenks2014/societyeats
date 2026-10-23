import { ApiError } from '@/lib/api';

/**
 * ONE state machine for every order status change, with role checks.
 * Home-kitchen flow:
 *   placed ─fee paid→ fee_paid ─buyer says "I've paid"→ awaiting_kitchen_payment_confirmation
 *        ─kitchen confirms→ fee_paid ─accept→ accepted → preparing → ready
 *        → (out_for_delivery) → picked_up | delivered
 *   placed ─15 min→ expired        fee_paid/awaiting ─reject / no response→ cancelled
 * Mall flow (feature-flagged off) keeps the legacy `paid` / `refund_pending` states.
 */
export type OrderStatus =
  | 'placed'
  | 'fee_paid'
  | 'awaiting_kitchen_payment_confirmation'
  | 'expired'
  | 'paid'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'picked_up'
  | 'cancelled'
  | 'refund_pending'
  | 'delivery_unassigned';

export type Actor = 'buyer' | 'seller' | 'restaurant' | 'admin' | 'system';

export type OrderAction =
  | 'pay_fee'
  | 'pay_mall'
  | 'expire'
  | 'claim_food_paid'
  | 'confirm_food_paid'
  | 'food_not_received'
  | 'accept'
  | 'reject'
  | 'auto_cancel'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'handover_pickup'
  | 'handover_delivery';

type Rule = { from: OrderStatus[]; to: OrderStatus; actors: Actor[] };

const KITCHEN: Actor[] = ['seller', 'restaurant', 'admin'];

export const TRANSITIONS: Record<OrderAction, Rule> = {
  pay_fee: { from: ['placed'], to: 'fee_paid', actors: ['system', 'buyer'] },
  pay_mall: { from: ['placed'], to: 'paid', actors: ['system', 'buyer'] },
  expire: { from: ['placed'], to: 'expired', actors: ['system'] },
  claim_food_paid: { from: ['fee_paid'], to: 'awaiting_kitchen_payment_confirmation', actors: ['buyer'] },
  confirm_food_paid: { from: ['awaiting_kitchen_payment_confirmation'], to: 'fee_paid', actors: ['seller', 'admin'] },
  food_not_received: { from: ['awaiting_kitchen_payment_confirmation'], to: 'fee_paid', actors: ['seller', 'admin'] },
  accept: { from: ['fee_paid', 'awaiting_kitchen_payment_confirmation', 'paid'], to: 'accepted', actors: KITCHEN },
  reject: { from: ['fee_paid', 'awaiting_kitchen_payment_confirmation', 'paid'], to: 'cancelled', actors: KITCHEN },
  auto_cancel: { from: ['fee_paid', 'awaiting_kitchen_payment_confirmation'], to: 'cancelled', actors: ['system'] },
  preparing: { from: ['accepted'], to: 'preparing', actors: KITCHEN },
  ready: { from: ['accepted', 'preparing'], to: 'ready', actors: KITCHEN },
  out_for_delivery: { from: ['ready'], to: 'out_for_delivery', actors: KITCHEN },
  handover_pickup: { from: ['ready'], to: 'picked_up', actors: KITCHEN },
  handover_delivery: { from: ['out_for_delivery'], to: 'delivered', actors: KITCHEN },
};

/** States from which an order can still become a completed meal. */
export const OPEN_STATES: OrderStatus[] = ['fee_paid', 'awaiting_kitchen_payment_confirmation', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivery_unassigned'];
export const TERMINAL_STATES: OrderStatus[] = ['delivered', 'picked_up', 'cancelled', 'expired', 'refund_pending'];
export const COMPLETED_STATES: OrderStatus[] = ['delivered', 'picked_up'];

/** Throws ApiError unless `actor` may perform `action` on an order in `from`. Returns the target status. */
export function nextOrderStatus(from: OrderStatus, action: OrderAction, actor: Actor): OrderStatus {
  const rule = TRANSITIONS[action];
  if (!rule) throw new ApiError(400, 'Unknown action');
  if (!rule.actors.includes(actor)) throw new ApiError(403, 'You cannot do that on this order');
  if (!rule.from.includes(from)) {
    throw new ApiError(409, `Cannot ${action.replaceAll('_', ' ')} an order that is ${from.replaceAll('_', ' ')}`);
  }
  return rule.to;
}

export function canTransition(from: OrderStatus, action: OrderAction, actor: Actor): boolean {
  try {
    nextOrderStatus(from, action, actor);
    return true;
  } catch {
    return false;
  }
}

/** Human labels for timelines and badges. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Awaiting platform-fee payment',
  fee_paid: 'Sent to kitchen',
  awaiting_kitchen_payment_confirmation: 'Kitchen confirming your UPI payment',
  expired: 'Expired — fee not paid',
  paid: 'Paid',
  accepted: 'Accepted',
  preparing: 'Cooking',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  refund_pending: 'Refund pending',
  delivery_unassigned: 'Finding a rider',
};
