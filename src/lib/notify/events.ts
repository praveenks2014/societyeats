import { formatINR } from '@/lib/money';
import { BRAND } from '@/config/brand';

/**
 * The notification catalogue (Pilot v2 step 13). One entry per event, each with its templates. Templates live in code and are
 * versioned: bump TEMPLATE_VERSION when wording changes so a stored notification can be traced to the text that produced it.
 * `urgent` events ignore quiet hours for push/SMS/WhatsApp. `email` marks transactional events that also go by email (always on).
 */
export const TEMPLATE_VERSION = 1;

export type Ctx = Record<string, string | number | boolean | null | undefined>;
type Built = { title: string; body: string; href: string };
type Def = { description: string; urgent: boolean; email: boolean; debounceMinutes?: 'chat'; build: (c: Ctx) => Built };

const n = (c: Ctx) => `#${c.orderId}`;

export const EVENTS = {
  order_booked: { description: 'A new order is booked (fee paid): tell the kitchen', urgent: true, email: true, build: (c) => ({ title: `New order ${n(c)} 🔔`, body: c.when ? `${c.items ?? 'An order'} · scheduled for ${c.when}. Accept by ${c.acceptBy} or it auto-cancels and the buyer's fee is refunded.` : `${c.items ?? 'An order'} · accept within ${c.acceptMinutes ?? 20} minutes or it auto-cancels.`, href: '/seller/orders' }) },
  order_accepted: { description: 'The kitchen accepted: tell the buyer', urgent: false, email: true, build: (c) => ({ title: `Order ${n(c)} accepted ✅`, body: 'The kitchen has started on your order.', href: `/orders/${c.orderId}` }) },
  order_cancelled: {
    description: 'Declined or cancelled for any cause: tell the counterparty',
    urgent: false,
    email: true,
    build: (c) => {
      const href = c.role === 'seller' ? '/seller/orders' : `/orders/${c.orderId}`;
      const refund = c.refundPaise ? ` Your platform fee of ${formatINR(Number(c.refundPaise))} is being refunded` + (c.creditPaise ? ` and ${formatINR(Number(c.creditPaise))} credit was added.` : '.') : '';
      switch (c.cause) {
        case 'seller_decline': return { title: `Order ${n(c)} declined by the kitchen`, body: `The kitchen could not take this order.${refund}`, href };
        case 'seller_cancel': return { title: `Order ${n(c)} cancelled by the kitchen`, body: `We are sorry.${refund}`, href };
        case 'buyer_cancel': return { title: `Order ${n(c)} cancelled by the buyer`, body: c.role === 'seller' ? 'The buyer cancelled this order.' : c.refundPaise ? 'Your platform fee is being refunded.' : 'The platform fee is not refunded after the kitchen has accepted.', href };
        case 'auto_cancel': return { title: `Order ${n(c)} was not accepted`, body: c.role === 'seller' ? 'You did not accept in time and the order was cancelled.' : 'The kitchen did not respond in time. Your platform fee is being refunded.', href };
        case 'buyer_couldnt_pay': return { title: `Order ${n(c)} closed`, body: 'The food was not paid for at the door, so the order was cancelled. The platform fee is not refunded.', href };
        case 'no_show': return { title: `Order ${n(c)} closed`, body: 'The kitchen waited at the door and could not reach the buyer. The platform fee is not refunded.', href };
        default: return { title: `Order ${n(c)} cancelled by ${BRAND.name}`, body: String(c.reason ?? `Cancelled by ${BRAND.name}.`) + refund, href };
      }
    },
  },
  order_ready: { description: 'Order ready: tell the buyer', urgent: false, email: false, build: (c) => ({ title: c.pickup ? 'Order ready for pickup 🔔' : 'Order ready 🔔', body: c.pickup ? `Your order ${n(c)} is ready. Head to the kitchen.` : `Order ${n(c)} is ready and will be on its way shortly.`, href: `/orders/${c.orderId}` }) },
  refund_issued: { description: `${BRAND.name} refunded a platform fee after a complaint`, urgent: false, email: true, build: (c) => ({ title: `Platform fee refunded (order ${n(c)})`, body: `${formatINR(Number(c.refundPaise ?? 0))} is on its way back to you after we reviewed your complaint. Refunds take 5–7 working days.`, href: `/orders/${c.orderId}` }) },
  credit_issued: { description: `${BRAND.name} added credit after a complaint`, urgent: false, email: true, build: (c) => ({ title: `${BRAND.name} credit added`, body: `${formatINR(Number(c.creditPaise ?? 0))} of credit was added for order ${n(c)}. It reduces the platform fee on your next orders.`, href: `/orders/${c.orderId}` }) },
  broadcast: { description: `A message from ${BRAND.name} to a group`, urgent: false, email: true, build: (c) => ({ title: `${c.kind === 'service' ? 'Service message: ' : ''}${c.title ?? BRAND.name}`, body: String(c.body ?? ''), href: String(c.href ?? '/') }) },
  kitchen_cooking: { description: 'A favourite kitchen published today’s menu', urgent: false, email: false, build: (c) => ({ title: `${c.kitchen ?? 'A kitchen you follow'} is cooking today 🍲`, body: String(c.note || c.dishes || 'See today’s menu.').slice(0, 120), href: String(c.href ?? '/') }) },
  ops_alert: { description: 'An operational check failed (storage or scheduled jobs): tell the admins once per incident', urgent: true, email: true, build: (c) => ({ title: `${BRAND.name} needs attention: ${c.what ?? 'a system check'}`, body: String(c.detail ?? 'Open Admin → Go-live for details.'), href: '/admin/go-live' }) },
  ops_recovered: { description: 'An operational check is healthy again', urgent: false, email: true, build: (c) => ({ title: `Recovered: ${c.what ?? 'a system check'}`, body: String(c.detail ?? 'Everything is healthy again.'), href: '/admin/go-live' }) },
  plus_expiring: { description: 'Plus month ends in 3 days (it does not renew by itself)', urgent: false, email: true, build: (c) => ({ title: `Your ${BRAND.name} Plus ends soon`, body: `Your month ends on ${c.endsOn ?? 'soon'}. It will not renew by itself. Buy another month if you want to keep the discount.`, href: '/plus' }) },
  order_on_the_way: { description: 'On the way: tell the buyer', urgent: false, email: true, build: (c) => ({ title: 'Your order is on the way 🛵', body: `The kitchen is bringing order ${n(c)}. Pay for the food only after it reaches you.`, href: `/orders/${c.orderId}` }) },
  order_at_door: { description: 'At the door / ready to collect: tell the buyer', urgent: true, email: true, build: (c) => ({ title: c.pickup ? 'Collect your order' : 'The kitchen is at your door 🚪', body: `Pay ${formatINR(Number(c.foodPaise ?? 0))} to the kitchen by UPI once you have the food. Open the order to see the QR.`, href: `/orders/${c.orderId}` }) },
  order_payment_claimed: { description: 'Buyer says they paid: tell the kitchen to confirm', urgent: true, email: true, build: (c) => ({ title: `Order ${n(c)}: confirm payment`, body: `The buyer says they paid ${formatINR(Number(c.foodPaise ?? 0))}${c.utr ? `, UTR ${c.utr}` : ''}. Check your UPI app, then confirm.`, href: '/seller/orders' }) },
  order_payment_received: { description: 'Payment confirmed / order complete: tell the buyer', urgent: false, email: false, build: (c) => ({ title: `Order ${n(c)} complete 🎉`, body: 'The kitchen confirmed your payment. Thanks! Rate the kitchen and tell your neighbours.', href: `/orders/${c.orderId}` }) },
  order_payment_disputed: {
    description: 'Payment not found: tell the buyer and admins',
    urgent: true,
    email: true,
    build: (c) => c.role === 'admin' ? { title: `Payment dispute — order ${n(c)}`, body: 'The kitchen says the food payment was not received.', href: '/admin/disputes' } : { title: `Order ${n(c)}: payment not found`, body: `The kitchen could not find your payment. ${BRAND.name} will look into it. Please keep your UPI receipt.`, href: `/orders/${c.orderId}` },
  },
  chat_message: { description: 'New chat message (debounced)', urgent: false, email: false, debounceMinutes: 'chat', build: (c) => ({ title: `New message on order ${n(c)}`, body: String(c.preview ?? '').trim().slice(0, 100) || 'Open the order to read it.', href: c.role === 'seller' ? `/seller/orders?chat=${c.orderId}` : `/orders/${c.orderId}#messages` }) },
  strike_issued: { description: 'A strike was recorded against the user', urgent: true, email: true, build: (c) => ({ title: 'A strike was recorded on your account', body: `${c.reason ?? 'Order problem'}. ${c.count ?? 1} in the last ${c.windowDays ?? 30} days (limit ${c.limit ?? 3}).`, href: c.role === 'seller' ? '/seller' : '/orders' }) },
  onboarding_decision: { description: 'Kitchen onboarding decision', urgent: true, email: true, build: (c) => ({ title: c.decision === 'approved' ? 'Your kitchen is approved 🎉' : c.decision === 'changes' ? 'Changes needed on your kitchen application' : 'Your kitchen application was not approved', body: String(c.note ?? (c.decision === 'approved' ? 'You can go live once your UPI ID and FSSAI status are in place.' : 'Open your dashboard for details.')), href: '/seller' }) },
  fssai_tier_change: { description: 'FSSAI tier changed', urgent: false, email: true, build: (c) => ({ title: `FSSAI: ${String(c.label ?? c.tier ?? 'status updated')}`, body: String(c.body ?? 'Your FSSAI status changed.'), href: '/seller/compliance' }) },
  provisional_cap_reached: { description: 'Provisional sales cap reached', urgent: false, email: true, build: (c) => ({ title: 'You reached your provisional limit for today', body: `${c.which === 'total' ? 'Your total provisional sales limit' : 'Today’s provisional limit'} is reached. Orders resume ${c.which === 'total' ? 'once your FSSAI is verified' : 'tomorrow'}.`, href: '/seller/compliance' }) },
  plan_expiring: { description: 'Subscription expiring (tightest threshold only)', urgent: false, email: true, build: (c) => ({ title: c.days == null ? 'Your plan ends soon' : `Your plan ends in ${c.days} day${Number(c.days) === 1 ? '' : 's'}`, body: 'Renew to stay visible to neighbours.', href: String(c.href ?? '/seller/subscription') }) },
  listing_paused: { description: 'Kitchen listing paused', urgent: true, email: true, build: (c) => ({ title: 'Your kitchen is paused', body: String(c.reason ?? `${BRAND.name} paused your listings.`), href: '/seller' }) },
  grievance_received: { description: 'Automatic acknowledgement the moment a complaint is raised', urgent: false, email: true, build: (c) => ({ title: `We received your complaint (#${c.grievanceId})`, body: `This is your acknowledgement. Someone will pick it up within ${c.ackHours ?? 48} hours and we aim to resolve it within ${c.resolveDays ?? 30} days.`, href: '/legal/grievance' }) },
  grievance_acknowledged: { description: 'An admin picked the complaint up', urgent: false, email: false, build: (c) => ({ title: `We are looking into complaint #${c.grievanceId}`, body: `A ${BRAND.name} team member is handling it. We will tell you the outcome within ${c.resolveDays ?? 30} days.`, href: '/legal/grievance' }) },
  grievance_resolved: { description: 'Complaint resolved', urgent: false, email: true, build: (c) => ({ title: `Your complaint #${c.grievanceId} is resolved`, body: String(c.resolution ?? 'See the outcome in your account.'), href: '/legal/grievance' }) },
} satisfies Record<string, Def>;

export type EventKey = keyof typeof EVENTS;
export const EVENT_KEYS = Object.keys(EVENTS) as EventKey[];
