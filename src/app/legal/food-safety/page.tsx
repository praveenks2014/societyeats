import { BRAND } from '@/lib/config';
import { getPlatformSettings } from '@/lib/db/platform';

export default async function FoodSafetyPage() {
  const settings = await getPlatformSettings();
  return (
    <>
      <h1>Food Safety</h1>
      <p>
        Every kitchen on {BRAND.name} displays its FSSAI license number, or a clearly-marked amber
        "FSSAI Pending" badge while its application — filed on FoSCoS either by our compliance team
        or by the seller themselves using a GharSe-prefilled summary — is under process. Kitchens may
        operate with the pending badge for a limited grace window, after which their listings pause
        automatically until the license is granted.
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
        <li>
          Most home kitchens qualify for Basic Registration (turnover up to ₹1.5 crore, rule effective
          1 April 2026); some categories require a State License regardless of turnover — this is
          guidance, confirmed per kitchen on FoSCoS, not a blanket determination.
        </li>
      </ul>
      <p>
        Platform FSSAI license:{' '}
        {settings.platformFssaiCentralLicenseNo
          ? `Central License ${settings.platformFssaiCentralLicenseNo}.`
          : 'applied for.'}{' '}
        {BRAND.name} itself requires a Central FSSAI e-commerce license before commercial (live,
        non-mock) operations begin.
      </p>
    </>
  );
}
