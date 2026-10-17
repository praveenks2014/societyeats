import { BRAND } from '@/config/brand';

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>
        This policy is drafted with the Digital Personal Data Protection Act, 2023 (DPDP) in mind.
        {BRAND.appName} collects only what the marketplace needs to work.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account: name, phone number, email address, password (stored as a bcrypt hash).</li>
        <li>Location: the society or coordinates you choose, used solely for the 10 km radius matching and delivery.</li>
        <li>Orders & payments: order contents and payment status. Card/UPI details never touch our servers — they go directly to Razorpay.</li>
        <li>Kitchen compliance: FSSAI numbers and documents you upload. ID and address proofs are encrypted at rest, an Aadhaar number must be masked before upload, and these documents are deleted automatically after verification. Administrator views of such documents are logged.</li>
      </ul>
      <h2>What we share</h2>
      <ul>
        <li>Kitchens see an anonymous buyer handle (for example “Buyer #A7”) and your order contents. Your name and phone number are not shared; a delivery address is shared only for kitchen-delivered orders once accepted.</li>
        <li>A kitchen’s UPI ID is shown to a buyer only inside that buyer’s own order.</li>
        <li>We do not sell personal data.</li>
      </ul>
      <h2>Your rights</h2>
      <p>
        Write to {BRAND.supportEmail} to access, correct, or erase your data, or to raise a DPDP
        grievance. Data principal requests are honoured within statutory timelines.
      </p>
    </>
  );
}
