import { paymentsMode } from '@/lib/payments/mode';
import { BRAND } from '@/config/brand';

/**
 * Thin Razorpay adapter used ONLY for the platform's own revenue (kitchen
 * subscriptions and the buyer platform fee) and refunds of those. In
 * the `mock` payments mode every call is simulated and deterministic; in the
 * two Razorpay modes the real API is used. The account may be shared with
 * other apps, so every order is tagged `notes.app='padosiplate'` and the
 * webhook ignores anything that is not ours.
 */
export type PaymentKind = 'order_fee' | 'order_full' | 'kitchen_plan' | 'plus' | 'meal_plan' | 'bulk' | 'upi_check' | 'smoke';

function siteHost(): string {
  try {
    return new URL(process.env.SITE_URL ?? '').host || 'unknown';
  } catch {
    return 'unknown';
  }
}
export type RzpPayment = { id: string; order_id: string; status: string; amount: number; method?: string; vpa?: string; upi?: { vpa?: string } };

async function client() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing');
  const { default: Razorpay } = await import('razorpay');
  return { rzp: new Razorpay({ key_id: keyId, key_secret: keySecret }), keyId };
}

/** Receipts always start with `pp-` so they are recognisable on a shared Razorpay account. */
export function receiptFor(kind: 'o' | 's' | 'u', id: number): string {
  return `${BRAND.receiptPrefix}${kind}${id}`;
}

export async function createRazorpayOrder(input: { amountInPaise: number; receipt: string; kind: PaymentKind; ref: string | number; notes?: Record<string, string> }): Promise<{ id: string; keyId: string | null }> {
  if (!Number.isInteger(input.amountInPaise) || input.amountInPaise < 100) throw new Error('Razorpay amount must be an integer of at least 100 paise');
  if (paymentsMode() === 'mock') return { id: `order_MOCK_${input.receipt}_${Date.now().toString(36)}`, keyId: null };
  if (!input.receipt.startsWith('pp-')) throw new Error('Razorpay receipts must start with pp-');
  const { rzp, keyId } = await client();
  const notes = { ...input.notes, app: 'padosiplate', env: siteHost(), kind: input.kind, ref: String(input.ref) };
  // payment_capture: 1 = auto-capture; ensureCaptured() still verifies (and captures an `authorized` payment) before anything is marked paid
  const o = await rzp.orders.create({ amount: input.amountInPaise, currency: 'INR', receipt: input.receipt, notes, payment_capture: 1 } as Parameters<typeof rzp.orders.create>[0]);
  return { id: o.id, keyId };
}

/** Fetch a payment from Razorpay (live mode verification of the client's claim). */
export async function fetchRazorpayPayment(paymentId: string): Promise<RzpPayment> {
  const { rzp } = await client();
  const p = (await rzp.payments.fetch(paymentId)) as unknown as RzpPayment;
  return p;
}

/** Capture an `authorized` payment for exactly the stored amount (INR). */
export async function captureRazorpayPayment(paymentId: string, amountInPaise: number): Promise<RzpPayment> {
  const { rzp } = await client();
  return (await rzp.payments.capture(paymentId, amountInPaise, 'INR')) as unknown as RzpPayment;
}

export async function createRazorpayRefund(input: { paymentId: string; amountInPaise: number; notes?: Record<string, string> }): Promise<{ id: string; status: 'processed' | 'pending' }> {
  if (paymentsMode() === 'mock') return { id: `rfnd_MOCK_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, status: 'processed' };
  const { rzp } = await client();
  const r = await rzp.payments.refund(input.paymentId, { amount: input.amountInPaise, notes: { ...input.notes, app: 'padosiplate' }, speed: 'normal' });
  return { id: r.id, status: r.status === 'processed' ? 'processed' : 'pending' };
}
