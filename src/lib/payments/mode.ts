import { ApiError } from '@/lib/api';
import { log } from '@/lib/log';

/**
 * How payments are taken, independent of MOCK_MODE (which still governs the non-payment adapters: geocoding, FSSAI lookup, delivery, SMS/WhatsApp).
 *
 *   PAYMENTS_ADAPTER=mock                        → mock          (explicit override)
 *   RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET unset → mock
 *   RAZORPAY_KEY_ID starts with rzp_test_        → razorpay_test (real Checkout and API, Razorpay test mode, no real money)
 *   RAZORPAY_KEY_ID starts with rzp_live_        → razorpay_live (real money; the go-live guard applies, and MOCK_MODE must be false)
 *   any other prefix                             → payments refuse to start (503), the configuration error names only the prefix
 */
export type PaymentsMode = 'mock' | 'razorpay_test' | 'razorpay_live';
type Env = Record<string, string | undefined>;

export type PaymentsModeInfo = { mode: PaymentsMode; prefix: string | null } | { mode: null; prefix: string };

/** Never throws and never exposes more than the key prefix: for pages, health and the admin banner. */
export function paymentsModeInfo(env: Env = process.env): PaymentsModeInfo {
  if (env.PAYMENTS_ADAPTER === 'mock') return { mode: 'mock', prefix: null };
  const id = env.RAZORPAY_KEY_ID?.trim();
  if (!id || !env.RAZORPAY_KEY_SECRET?.trim()) return { mode: 'mock', prefix: null };
  if (id.startsWith('rzp_test_')) return { mode: 'razorpay_test', prefix: 'rzp_test_' };
  if (id.startsWith('rzp_live_')) return { mode: 'razorpay_live', prefix: 'rzp_live_' };
  return { mode: null, prefix: safePrefix(id) };
}

/** What we may say about a key we do not recognise: at most a short `abc_def_` style prefix, never any of the secret part. */
function safePrefix(id: string): string {
  return id.match(/^([A-Za-z0-9]{1,6}_[A-Za-z0-9]{1,6}_)/)?.[1] ?? '(unrecognised)';
}

let warned = false;

/** The mode every payment path uses. Throws 503 on an unrecognised key prefix, so no payment is ever created with keys we cannot classify. */
export function paymentsMode(env: Env = process.env): PaymentsMode {
  const info = paymentsModeInfo(env);
  if (info.mode) return info.mode;
  if (!warned) {
    warned = true;
    log.error('payments.config', { problem: 'RAZORPAY_KEY_ID has an unrecognised prefix; expected rzp_test_ or rzp_live_', prefix: info.prefix });
  }
  throw new ApiError(503, 'Payments are not configured correctly: the Razorpay key must start with rzp_test_ or rzp_live_.');
}

/** True only for the fake checkout. Safe for server pages (an invalid key never shows the fake sheet). */
export function isMockPayments(env: Env = process.env): boolean {
  return paymentsModeInfo(env).mode === 'mock';
}

/** Mock-only routes answer 404 in every other mode, so a real-keys deployment can never mark anything paid for free. */
export function assertMockPaymentsOnly(env: Env = process.env): void {
  if (!isMockPayments(env)) throw new ApiError(404, 'Not found');
}

/** Test-reset hook for the one-time warning. */
export function _resetPaymentsModeWarning() {
  warned = false;
}
