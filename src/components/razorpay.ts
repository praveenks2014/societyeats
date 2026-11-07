'use client';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

/** The `leaf` colour token from tailwind.config.ts (tests/unit/payments-mode.test.ts keeps the two in step). */
export const RAZORPAY_THEME = '#1E4D2B';

/** The per-request CSP nonce Next put on its own scripts, so a script we add is allowed under the nonce policy. */
function pageNonce(): string {
  return document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
}

/**
 * Loads checkout.js on demand (with the page's CSP nonce) and opens the real Razorpay Checkout, in test or live mode alike.
 * It prefills the payer's name and e-mail only, taken from their own session.
 */
export function launchRazorpay(o: {
  keyId: string;
  razorpayOrderId: string;
  amountInPaise: number;
  description: string;
  /** e.g. UPI only for the ₹1 ownership check */
  method?: Record<string, boolean>;
  onSuccess: (r: RazorpaySuccess) => void;
  onDismiss: () => void;
  onLoadError: () => void;
}) {
  const open = async () => {
    const me = await fetch('/api/auth/me').then((r) => r.json()).catch(() => null);
    const u = me?.session as { name?: string; email?: string } | null | undefined;
    const rzp = new window.Razorpay!({
      key: o.keyId,
      amount: o.amountInPaise,
      currency: 'INR',
      name: 'PadosiPlate',
      description: o.description,
      order_id: o.razorpayOrderId,
      ...(o.method ? { method: o.method } : {}),
      prefill: { ...(u?.name ? { name: u.name } : {}), ...(u?.email ? { email: u.email } : {}) },
      handler: o.onSuccess,
      modal: { ondismiss: o.onDismiss },
      theme: { color: RAZORPAY_THEME },
    });
    rzp.open();
  };
  if (window.Razorpay) return void open();
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  const nonce = pageNonce();
  if (nonce) s.nonce = nonce;
  s.onload = () => void open();
  s.onerror = o.onLoadError;
  document.body.appendChild(s);
}
