import { BRAND } from '@/lib/config';

export default function RefundsPage() {
  return (
    <>
      <h1>Cancellations & Refunds</h1>
      <h2>Before the kitchen accepts</h2>
      <p>
        Orders cancelled before acceptance are refunded in full to the original payment method
        within 5–7 business days.
      </p>
      <h2>If the kitchen rejects your order</h2>
      <p>
        You are refunded in full automatically — the order shows "Refund on the way" and the
        payment is reversed via Razorpay.
      </p>
      <h2>After cooking starts</h2>
      <p>
        Home kitchens cook in small batches and cannot resell a prepared order, so cancellations
        after acceptance are generally not refundable. Quality issues (spoiled, wrong, or
        incomplete orders) reported within 2 hours of delivery with photos are refunded partially
        or fully after review.
      </p>
      <h2>Delivery failures</h2>
      <p>
        If no delivery partner can be assigned and the order cannot be fulfilled, {BRAND.name}
        refunds the full amount including delivery fee.
      </p>
      <p>Raise refund requests at {BRAND.supportEmail} with your order number.</p>
    </>
  );
}
