'use client';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

/** Loads checkout.js on demand and opens Razorpay Checkout. */
export function launchRazorpay(o: {
  keyId: string;
  razorpayOrderId: string;
  amountInPaise: number;
  description: string;
  onSuccess: (r: RazorpaySuccess) => void;
  onDismiss: () => void;
  onLoadError: () => void;
}) {
  const open = () => {
    const rzp = new window.Razorpay!({
      key: o.keyId,
      amount: o.amountInPaise,
      currency: 'INR',
      name: 'PadosiPlate',
      description: o.description,
      order_id: o.razorpayOrderId,
      handler: o.onSuccess,
      modal: { ondismiss: o.onDismiss },
      theme: { color: '#1E4D2B' },
    });
    rzp.open();
  };
  if (window.Razorpay) return open();
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = open;
  s.onerror = o.onLoadError;
  document.body.appendChild(s);
}
