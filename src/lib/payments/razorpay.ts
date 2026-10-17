import { isMockMode } from '@/lib/config';
import { BRAND } from '@/config/brand';

/**
 * Thin Razorpay adapter used ONLY for the platform's own revenue (kitchen
 * subscriptions and the buyer platform fee) and refunds of those. In
 * MOCK_MODE every call is simulated and deterministic.
 */
export type RzpPayment = { id: string; order_id: string; status: string; amount: number; method?: string };

async function client() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing with MOCK_MODE=false');
  const { default: Razorpay } = await import('razorpay');
  return { rzp: new Razorpay({ key_id: keyId, key_secret: keySecret }), keyId };
}

export function receiptFor(kind: 'o' | 's', id: number): string {
  return `${BRAND.receiptPrefix}${kind}${id}`;
}

export async function createRazorpayOrder(input: { amountInPaise: number; receipt: string; notes?: Record<string, string> }): Promise<{ id: string; keyId: string | null }> {
  if (!Number.isInteger(input.amountInPaise) || input.amountInPaise < 100) throw new Error('Razorpay amount must be an integer of at least 100 paise');
  if (isMockMode()) return { id: `order_MOCK_${input.receipt}_${Date.now().toString(36)}`, keyId: null };
  const { rzp, keyId } = await client();
  const o = await rzp.orders.create({ amount: input.amountInPaise, currency: 'INR', receipt: input.receipt, notes: input.notes });
  return { id: o.id, keyId };
}

/** Fetch a payment from Razorpay (live mode verification of the client's claim). */
export async function fetchRazorpayPayment(paymentId: string): Promise<RzpPayment> {
  const { rzp } = await client();
  const p = (await rzp.payments.fetch(paymentId)) as unknown as RzpPayment;
  return p;
}

export async function createRazorpayRefund(input: { paymentId: string; amountInPaise: number; notes?: Record<string, string> }): Promise<{ id: string; status: 'processed' | 'pending' }> {
  if (isMockMode()) return { id: `rfnd_MOCK_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, status: 'processed' };
  const { rzp } = await client();
  const r = await rzp.payments.refund(input.paymentId, { amount: input.amountInPaise, notes: input.notes, speed: 'normal' });
  return { id: r.id, status: r.status === 'processed' ? 'processed' : 'pending' };
}
