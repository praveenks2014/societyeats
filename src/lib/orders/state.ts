import { ApiError } from '@/lib/api';

/**
 * ONE state machine for every order status change, with role checks.
 *
 * Home-kitchen flow (Pilot v2). The buyer pays ONLY the platform fee online;
 * the food is paid directly to the kitchen at the door.
 *
 *   fee_pending ─fee captured→ booked ─accept→ accepted → preparing → ready
 *        │                       │                                      │
 *        │ 15 min                │ no accept in 20 min                  ├ delivery: on_the_way ─reached door→ at_door
 *        ▼                       ▼                                      └ pickup:   buyer arrived ────────────→ at_door
 *     expired               cancelled_auto
 *
 *   at_door ─collected→ collected ─"I've paid"→ payment_claimed ─"received"→ completed
 *      │                    │                        │
 *      │ couldn't pay       │ kitchen raises         └─ "not received" → payment_disputed → (admin) completed | closed_unpaid
 *      ▼                    ▼
 *   cancelled_buyer_unpaid / no_show_buyer      payment_disputed
 *
 *   booked..on_the_way ─seller cancels→ cancelled_by_seller   booked/accepted ─buyer cancels→ cancelled_by_buyer
 *
 * Mall flow (feature-flagged off) keeps the legacy `paid` / `picked_up` / `refund_pending` states.
 */
export type OrderStatus =
  | 'fee_pending'
  | 'booked'
  | 'awaiting_kitchen_payment_confirmation'
  | 'expired'
  | 'paid'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'on_the_way'
  | 'delivered'
  | 'picked_up'
  | 'cancelled'
  | 'refund_pending'
  | 'delivery_unassigned'
  | 'at_door'
  | 'collected'
  | 'payment_claimed'
  | 'completed'
  | 'payment_disputed'
  | 'closed_unpaid'
  | 'cancelled_by_seller'
  | 'cancelled_by_buyer'
  | 'cancelled_auto'
  | 'cancelled_buyer_unpaid'
  | 'no_show_buyer';

export type Actor = 'buyer' | 'seller' | 'restaurant' | 'admin' | 'system';

export type OrderAction =
  | 'pay_fee'
  | 'pay_mall'
  | 'expire'
  | 'accept'
  | 'preparing'
  | 'ready'
  | 'on_the_way'
  | 'reached_door'
  | 'buyer_arrived'
  | 'collect'
  | 'claim_paid'
  | 'confirm_paid'
  | 'not_received'
  | 'raise_dispute'
  | 'auto_complete'
  | 'resolve_paid'
  | 'resolve_unpaid'
  | 'buyer_couldnt_pay'
  | 'no_show'
  | 'seller_cancel'
  | 'buyer_cancel'
  | 'auto_cancel'
  | 'admin_cancel'
  | 'handover_pickup'; // Mall only

type Rule = { from: OrderStatus[]; to: OrderStatus; actors: Actor[] };

const KITCHEN: Actor[] = ['seller', 'restaurant', 'admin'];
const SELLER: Actor[] = ['seller', 'admin'];

/** Statuses from which the kitchen may still cancel (everything before the door). */
export const SELLER_CANCELLABLE: OrderStatus[] = ['booked', 'accepted', 'preparing', 'ready', 'on_the_way', 'paid'];

export const TRANSITIONS: Record<OrderAction, Rule> = {
  pay_fee: { from: ['fee_pending'], to: 'booked', actors: ['system', 'buyer'] },
  pay_mall: { from: ['fee_pending'], to: 'paid', actors: ['system', 'buyer'] },
  expire: { from: ['fee_pending'], to: 'expired', actors: ['system'] },
  accept: { from: ['booked', 'paid'], to: 'accepted', actors: KITCHEN },
  preparing: { from: ['accepted'], to: 'preparing', actors: KITCHEN },
  ready: { from: ['accepted', 'preparing'], to: 'ready', actors: KITCHEN },
  on_the_way: { from: ['ready'], to: 'on_the_way', actors: SELLER },
  reached_door: { from: ['on_the_way'], to: 'at_door', actors: SELLER },
  buyer_arrived: { from: ['ready'], to: 'at_door', actors: SELLER },
  collect: { from: ['at_door'], to: 'collected', actors: ['buyer'] },
  claim_paid: { from: ['collected'], to: 'payment_claimed', actors: ['buyer'] },
  confirm_paid: { from: ['payment_claimed', 'collected'], to: 'completed', actors: SELLER },
  not_received: { from: ['payment_claimed'], to: 'payment_disputed', actors: SELLER },
  raise_dispute: { from: ['collected'], to: 'payment_disputed', actors: SELLER },
  auto_complete: { from: ['payment_claimed'], to: 'completed', actors: ['system'] },
  resolve_paid: { from: ['payment_disputed'], to: 'completed', actors: ['admin'] },
  resolve_unpaid: { from: ['payment_disputed'], to: 'closed_unpaid', actors: ['admin'] },
  buyer_couldnt_pay: { from: ['at_door'], to: 'cancelled_buyer_unpaid', actors: SELLER },
  no_show: { from: ['at_door'], to: 'no_show_buyer', actors: SELLER },
  seller_cancel: { from: SELLER_CANCELLABLE, to: 'cancelled_by_seller', actors: SELLER },
  buyer_cancel: { from: ['booked', 'accepted'], to: 'cancelled_by_buyer', actors: ['buyer'] },
  auto_cancel: { from: ['booked'], to: 'cancelled_auto', actors: ['system'] },
  admin_cancel: { from: ['booked', 'accepted', 'preparing', 'ready', 'on_the_way', 'at_door', 'collected', 'payment_claimed'], to: 'cancelled_auto', actors: ['admin'] },
  handover_pickup: { from: ['ready'], to: 'picked_up', actors: KITCHEN },
};

/** Orders that can still become a completed meal. */
export const OPEN_STATES: OrderStatus[] = [
  'booked', 'awaiting_kitchen_payment_confirmation', 'paid', 'accepted', 'preparing', 'ready', 'on_the_way',
  'at_door', 'collected', 'payment_claimed', 'payment_disputed', 'delivery_unassigned',
];
/** Open home orders that hold stock / count against caps until they resolve. */
export const ACTIVE_STATES: OrderStatus[] = ['fee_pending', ...OPEN_STATES];
export const CANCELLED_STATES: OrderStatus[] = ['cancelled', 'cancelled_by_seller', 'cancelled_by_buyer', 'cancelled_auto', 'cancelled_buyer_unpaid', 'no_show_buyer', 'expired'];
export const COMPLETED_STATES: OrderStatus[] = ['completed', 'delivered', 'picked_up'];
export const TERMINAL_STATES: OrderStatus[] = [...COMPLETED_STATES, ...CANCELLED_STATES, 'refund_pending', 'closed_unpaid'];
/** States in which the kitchen's revenue is real food sold (counts toward FY sales / caps / ratings). */
export const SOLD_STATES: OrderStatus[] = [...COMPLETED_STATES];
/** States where the seller's UPI ID and the QR may be revealed to the buyer. */
export const QR_REVEAL_STATES: OrderStatus[] = ['at_door', 'collected', 'payment_claimed', 'payment_disputed'];
/** States in which the delivery address (flat) is visible to the kitchen. */
export const ADDRESS_VISIBLE_STATES: OrderStatus[] = ['accepted', 'preparing', 'ready', 'on_the_way', 'at_door', 'collected', 'payment_claimed', 'payment_disputed', 'completed', 'closed_unpaid', 'no_show_buyer', 'cancelled_buyer_unpaid'];

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

/** What each cancellation does to the buyer's money and to strikes. One table, one place. */
export type CancelKind = 'buyer_before_accept' | 'buyer_after_accept' | 'seller_decline' | 'seller_cancel' | 'auto_no_accept' | 'buyer_couldnt_pay' | 'buyer_no_show' | 'admin';
export type CancelPolicy = {
  /** The platform fee is refunded to the buyer. */
  refundFee: boolean;
  /** An equal-value Kootu credit is also issued (platform-funded). */
  credit: boolean;
  /** A strike against the buyer or the kitchen. */
  strike: { role: 'buyer' | 'seller'; kind: 'seller_cancel' | 'seller_missed' | 'buyer_late_cancel' | 'buyer_unpaid' | 'buyer_no_show' } | null;
};

export function cancelPolicy(kind: CancelKind, opts: { feeRetainedOnLateBuyerCancel?: boolean } = {}): CancelPolicy {
  const retain = opts.feeRetainedOnLateBuyerCancel ?? true;
  switch (kind) {
    case 'buyer_before_accept':
      return { refundFee: true, credit: false, strike: null };
    case 'buyer_after_accept':
      return { refundFee: !retain, credit: false, strike: { role: 'buyer', kind: 'buyer_late_cancel' } };
    // A kitchen that declines a booked order before accepting commits to nothing: full refund + credit, no strike.
    case 'seller_decline':
      return { refundFee: true, credit: true, strike: null };
    case 'seller_cancel':
      return { refundFee: true, credit: true, strike: { role: 'seller', kind: 'seller_cancel' } };
    case 'auto_no_accept':
      return { refundFee: true, credit: false, strike: { role: 'seller', kind: 'seller_missed' } };
    case 'buyer_couldnt_pay':
      return { refundFee: false, credit: false, strike: { role: 'buyer', kind: 'buyer_unpaid' } };
    case 'buyer_no_show':
      return { refundFee: false, credit: false, strike: { role: 'buyer', kind: 'buyer_no_show' } };
    case 'admin':
      return { refundFee: true, credit: false, strike: null };
  }
}

/** Human labels for timelines and badges. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  fee_pending: 'Awaiting platform-fee payment',
  booked: 'Booked — waiting for the kitchen',
  awaiting_kitchen_payment_confirmation: 'Kitchen confirming payment',
  expired: 'Expired — fee not paid',
  paid: 'Paid',
  accepted: 'Accepted',
  preparing: 'Cooking',
  ready: 'Ready',
  on_the_way: 'On the way',
  delivered: 'Delivered',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  refund_pending: 'Refund pending',
  delivery_unassigned: 'Finding a rider',
  at_door: 'At your door',
  collected: 'Collected — pay the kitchen',
  payment_claimed: 'Payment sent — kitchen confirming',
  completed: 'Completed',
  payment_disputed: 'Payment under review',
  closed_unpaid: 'Closed — unpaid',
  cancelled_by_seller: 'Cancelled by the kitchen',
  cancelled_by_buyer: 'Cancelled by you',
  cancelled_auto: 'Cancelled — kitchen did not respond',
  cancelled_buyer_unpaid: 'Cancelled — payment not made at the door',
  no_show_buyer: 'Cancelled — buyer not at the door',
};

export const isCancelled = (s: OrderStatus) => CANCELLED_STATES.includes(s);
export const isCompleted = (s: OrderStatus) => COMPLETED_STATES.includes(s);
export const isTerminal = (s: OrderStatus) => TERMINAL_STATES.includes(s);
