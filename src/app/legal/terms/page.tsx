import { BRAND } from '@/lib/config';

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>
        {BRAND.name} is a marketplace that connects buyers with independent home kitchens and
        food-court restaurants ("Sellers"). {BRAND.name} is not the manufacturer or preparer of any
        food sold on the platform; each Seller is an independent food business operator responsible
        for the food they prepare and its compliance with the Food Safety and Standards Act, 2006.
      </p>
      <h2>Marketplace role</h2>
      <ul>
        <li>Orders are contracts between the buyer and the Seller. {BRAND.name} facilitates discovery, payment collection and delivery logistics.</li>
        <li>Delivery is fulfilled by third-party logistics partners; delivery fees are passed through at cost.</li>
        <li>{BRAND.name} charges Sellers a disclosed commission per order, shown on their earnings page.</li>
      </ul>
      <h2>Accounts</h2>
      <ul>
        <li>You must provide a valid Indian mobile number and keep your credentials safe.</li>
        <li>Sellers must hold, or have applied for, an FSSAI license/registration. Displaying false license information is grounds for immediate removal and may be reported.</li>
      </ul>
      <h2>Grievance officer</h2>
      <p>
        As required by the Consumer Protection (E-Commerce) Rules, 2020: {BRAND.grievanceOfficer}.
        Grievances are acknowledged within 48 hours and resolved within 30 days.
      </p>
    </>
  );
}
