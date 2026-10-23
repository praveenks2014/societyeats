import { BRAND } from '@/config/brand';

export default function RefundsPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <p>Because food and platform money travel separately, refunds do too.</p>
      <h2>The platform fee (paid to {BRAND.appName} via Razorpay)</h2>
      <ul>
        <li><strong>Kitchen declines, or doesn’t accept in time:</strong> refunded in full, automatically, to your original payment method.</li>
        <li><strong>Platform fee paid but order expired or was cancelled before reaching the kitchen:</strong> refunded in full automatically.</li>
        <li><strong>Upheld complaint:</strong> PadosiPlate decides whether to refund all or part of the platform fee.</li>
        <li>Refunds normally reach your account in 5–7 working days after they are processed.</li>
      </ul>
      <h2>The food (paid directly to the kitchen)</h2>
      <ul>
        <li><strong>Paid by UPI, then the order is cancelled:</strong> the kitchen owes you the food amount. The kitchen is asked to return it and to record the UPI reference; {BRAND.appName} follows up with the kitchen.</li>
        <li><strong>Pay at pickup:</strong> if you haven’t paid, there is nothing to refund. If you paid at hand-over and a complaint is upheld, the kitchen owes you the food refund.</li>
        <li>{BRAND.appName} does not hold food money, so it cannot refund it itself; it tracks outstanding kitchen refunds and can suspend kitchens that don’t return them.</li>
      </ul>
      <h2>How to complain</h2>
      <p>Open the order, then “Report an issue” within 24 hours of delivery or pickup. You can also message the kitchen first; your names and phone numbers stay private.</p>
      <h2>Kitchen subscriptions</h2>
      <p>Non-refundable except at {BRAND.appName}’s discretion, decided case by case by an administrator.</p>
    </>
  );
}
