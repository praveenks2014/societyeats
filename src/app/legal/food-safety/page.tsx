import { BRAND } from '@/lib/config';

export default function FoodSafetyPage() {
  return (
    <>
      <h1>Food Safety</h1>
      <p>
        Every kitchen on {BRAND.name} displays its FSSAI license number, or a clearly-marked amber
        "FSSAI Pending" badge while its application (filed by our compliance team on FoSCoS) is
        under process. Kitchens may operate with the pending badge for a limited grace window, after
        which their listings pause automatically until the license is granted.
      </p>
      <h2>What we check</h2>
      <ul>
        <li>FSSAI license verification against FoSCoS records before the green badge appears.</li>
        <li>Manual kitchen approval by the {BRAND.name} team before a Seller can go live.</li>
        <li>Buyer ratings and reports — kitchens that fall below safety expectations are delisted.</li>
      </ul>
      <h2>What buyers should know</h2>
      <ul>
        <li>Home-cooked food is prepared in domestic kitchens, not commercial facilities.</li>
        <li>Allergen information is provided by Sellers; ask the kitchen through support if unsure.</li>
        <li>The veg/non-veg mark on every dish follows the FSSAI green/brown convention.</li>
      </ul>
      <p>
        Platform FSSAI license: applied for. {BRAND.name} itself requires a Central FSSAI e-commerce
        license before commercial operations begin.
      </p>
    </>
  );
}
