import { BRAND } from '@/lib/config';

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>
        This policy is drafted with the Digital Personal Data Protection Act, 2023 (DPDP) in mind.
        {BRAND.name} collects only what the marketplace needs to work.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account: name, phone number, password (stored as a bcrypt hash).</li>
        <li>Location: the society or coordinates you choose, used solely for the 10 km radius matching and delivery.</li>
        <li>Orders & payments: order contents and payment status. Card/UPI details never touch our servers — they go directly to Razorpay.</li>
        <li>Seller compliance: FSSAI numbers and application documents you upload.</li>
      </ul>
      <h2>What we share</h2>
      <ul>
        <li>Delivery partners receive pickup/drop addresses and contact numbers to fulfil your order.</li>
        <li>Sellers see your name, delivery address and order contents — never your payment details.</li>
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
