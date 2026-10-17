import { BRAND } from '@/config/brand';
import { getPlatformSettings } from '@/lib/db/platform';

export default async function KitchenTermsPage() {
  const s = await getPlatformSettings();
  return (
    <>
      <h1>Kitchen Terms</h1>
      <p>These terms apply to residents who list a home kitchen on {BRAND.appName}.</p>
      <h2>Listing &amp; subscription</h2>
      <ul>
        <li>To be listed, a kitchen pays a subscription for a chosen period ({s.subscriptionGraceDays}-day grace period after it ends, during which dishes stay visible). After grace, your dishes are hidden — not deleted — until you renew.</li>
        <li>The subscription is {BRAND.appName}’s own service fee. It is <strong>non-refundable except at {BRAND.appName}’s discretion</strong>. Early renewals stack onto your current period.</li>
        <li>{BRAND.appName} may grant complimentary periods (for example for founding kitchens) and may extend or cancel a period with a recorded reason.</li>
        <li>Each listing request is reviewed. We may approve, ask for changes, or decline.</li>
      </ul>
      <h2>You are paid directly</h2>
      <ul>
        <li>Buyers pay you directly — UPI to the ID you provide, or at pickup. You confirm UPI payments you receive and record payments taken at hand-over.</li>
        <li>{BRAND.appName} does not collect, hold or pay out your food sales and takes no commission on them. Buyers pay the platform fee separately.</li>
        <li>If you decline or cancel an order after a buyer has paid you by UPI, or a complaint is upheld, you must return the food amount to the buyer and record the UPI reference.</li>
      </ul>
      <h2>Food safety</h2>
      <p>You must hold or have applied for the FSSAI registration/licence appropriate to your business and keep it current. An expired registration unpublishes your listings until renewed.</p>
      <h2>Delisting</h2>
      <p>We may delist your kitchen or individual dishes, for example for hygiene concerns, repeated upheld complaints, misleading listings, an FSSAI problem, or unreturned refunds owed to buyers. Orders you have already accepted can still be completed. Delisting does not change your subscription; we may separately extend it. You will be told the reason by in-app message and email.</p>
      <h2>Contact</h2>
      <p>{s.grievanceOfficer || BRAND.grievanceOfficer} · {BRAND.supportEmail}</p>
    </>
  );
}
