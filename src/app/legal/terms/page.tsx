import { BRAND } from '@/config/brand';
import { getPlatformSettings } from '@/lib/db/platform';

export default async function TermsPage() {
  const s = await getPlatformSettings();
  const entity = s.legalEntityName || BRAND.legalEntityName;
  const feePct = s.buyerPlatformFeeBps / 100;
  return (
    <>
      <h1>Terms of Use</h1>
      <p>
        {BRAND.appName} (operated by {entity}) is a neighbourhood marketplace that helps residents discover and order food from independent home kitchens in their society and nearby societies. We are a technology platform — we do not cook, sell, deliver or handle food, and we are not a party to the sale of food between a buyer and a kitchen.
      </p>
      <h2>How money works</h2>
      <ul>
        <li><strong>You pay the kitchen directly for the food</strong> — by UPI to the kitchen’s own UPI ID, or at pickup (UPI or cash). {BRAND.appName} never collects, holds or routes your food payment.</li>
        <li><strong>The platform fee</strong> (currently {feePct}% of the food value{s.platformGstin ? ', plus GST' : ''}) is {BRAND.appName}’s own service charge for operating the marketplace. It is paid online through Razorpay when you place an order and shown separately from the food price at checkout.</li>
        <li>Kitchens pay {BRAND.appName} a <strong>subscription</strong> to be listed. That is also the platform’s own service charge.</li>
        <li>{BRAND.appName} does not hold a payment-aggregator licence and does not act as an escrow or settlement agent.</li>
      </ul>
      <h2>Orders</h2>
      <ul>
        <li>Placing an order sends it to the kitchen once the platform fee is paid. An order whose platform fee is not paid within {s.unpaidOrderExpiryMinutes} minutes expires.</li>
        <li>A kitchen may accept or decline an order. If it declines, or does not accept within {s.sellerAcceptWindowMinutes} minutes, the order is cancelled and your platform fee is refunded automatically.</li>
        <li>The food contract is between you and the kitchen. Hand-over is confirmed by the 4-digit code shown only to you.</li>
      </ul>
      <h2>Accounts</h2>
      <p>You must give a correct phone number and email, keep your password safe, and belong to the society you sign up for. We may suspend accounts that break these terms or the Kitchen Terms.</p>
      <h2>Contact &amp; grievances</h2>
      <p>{s.grievanceOfficer || BRAND.grievanceOfficer} · {BRAND.supportEmail}</p>
    </>
  );
}
