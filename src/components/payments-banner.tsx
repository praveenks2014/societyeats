import { isMockMode } from '@/lib/config';
import { paymentsModeInfo } from '@/lib/payments/mode';
import { LIVE_KEYS_NEED_LIVE_MODE } from '@/lib/live-guard';

/**
 * A slim notice about how payments behave right now. Server component: it reads the environment and never shows more than the key prefix.
 *   test keys                    → amber "Test payments: no real money is charged."
 *   live keys + MOCK_MODE=true   → red, admin screens only (every money action is refused until MOCK_MODE=false)
 */
export function PaymentsBanner({ admin = false }: { admin?: boolean }) {
  const info = paymentsModeInfo();
  if (info.mode === 'razorpay_test') {
    return (
      <p className="mt-3 rounded-xl bg-turmeric-tint px-4 py-2 text-center text-xs font-semibold text-turmeric-deep" role="status" data-testid="payments-banner-test">
        Test payments: no real money is charged.
      </p>
    );
  }
  if (admin && info.mode === 'razorpay_live' && isMockMode()) {
    return (
      <p className="mt-3 rounded-xl bg-chili-tint px-4 py-2 text-sm font-semibold text-chili-dark" role="alert" data-testid="payments-banner-live-blocked">
        {LIVE_KEYS_NEED_LIVE_MODE}
      </p>
    );
  }
  if (admin && info.mode === null) {
    return (
      <p className="mt-3 rounded-xl bg-chili-tint px-4 py-2 text-sm font-semibold text-chili-dark" role="alert" data-testid="payments-banner-invalid">
        The Razorpay key must start with rzp_test_ or rzp_live_. Payments are refused until it is fixed.
      </p>
    );
  }
  return null;
}
