import { ApiError } from '@/lib/api';
import { log } from '@/lib/log';
import { captureRazorpayPayment, fetchRazorpayPayment, type RzpPayment } from './razorpay';

/**
 * Live-mode gate used before anything is marked paid (checkout verify AND
 * webhook): the payment fetched from Razorpay must belong to the expected
 * Razorpay order, match the stored amount, and be `captured`.
 *
 * An `authorized` payment is captured here for exactly the stored amount in
 * INR and re-fetched to confirm. If capture fails (or the payment is in any
 * other state) this throws and the caller leaves the order/subscription unpaid.
 */
export async function ensureCaptured(input: { paymentId: string; razorpayOrderId: string; amountInPaise: number }): Promise<RzpPayment> {
  const { paymentId, razorpayOrderId, amountInPaise } = input;
  const rp = await fetchRazorpayPayment(paymentId);
  if (rp.order_id !== razorpayOrderId) throw new ApiError(400, 'Payment verification failed');
  if (rp.amount !== amountInPaise) throw new ApiError(400, 'Payment amount does not match');
  if (rp.status === 'captured') return rp;
  if (rp.status !== 'authorized') throw new ApiError(400, `Payment is not captured (status: ${rp.status})`);

  try {
    await captureRazorpayPayment(paymentId, amountInPaise);
  } catch (e) {
    log.error('payment.capture_failed', { paymentId, err: e });
    throw new ApiError(502, 'We could not capture your payment with Razorpay, so nothing was marked as paid. Any hold on your account is released by your bank automatically; please try again.');
  }
  const after = await fetchRazorpayPayment(paymentId);
  if (after.status !== 'captured') {
    log.error('payment.capture_unconfirmed', { paymentId, status: after.status });
    throw new ApiError(502, 'Razorpay did not confirm the capture, so nothing was marked as paid. Please try again or contact support.');
  }
  return after;
}
