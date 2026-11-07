'use client';

import { launchRazorpay } from '@/components/razorpay';

export function Probe() {
  return (
    <div className="mx-auto max-w-lg pt-6">
      <button
        className="min-h-[44px] rounded-xl bg-leaf px-4 font-semibold text-white"
        data-testid="probe-open"
        onClick={() => launchRazorpay({ keyId: 'rzp_test_probe', razorpayOrderId: 'order_probe', amountInPaise: 100, description: 'CSP probe', onSuccess: () => {}, onDismiss: () => {}, onLoadError: () => { (window as unknown as { __rzpLoadError?: boolean }).__rzpLoadError = true; } })}
      >
        Open Razorpay Checkout
      </button>
    </div>
  );
}
