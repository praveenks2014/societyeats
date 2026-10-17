import { BRAND } from '@/config/brand';
import { getPlatformSettings } from '@/lib/db/platform';

export default async function FoodSafetyPage() {
  const settings = await getPlatformSettings();
  return (
    <>
      <h1>Food Safety</h1>
      <p>
        Every kitchen on {BRAND.appName} displays its FSSAI license number, or a clearly-marked amber
        "FSSAI Pending" badge while its application — filed on FoSCoS by the seller themselves using
        a PadosiPlate-prefilled summary — is under process. FoSCoS has no public status API, so PadosiPlate
        tracks each filing by its reference number: once a filing has gone unanswered past the
        regulation's own deemed-commencement window (7 days for Basic Registration, 60 for a State
        License — unless FoSCoS responded with a rejection, inspection order, or inadequacy notice),
        the kitchen may go live under that provision even before a formal grant.
      </p>
      <h2>What we check</h2>
      <ul>
        <li>FSSAI license verification against FoSCoS records before the green badge appears.</li>
        <li>Manual kitchen approval by the {BRAND.appName} team before a Seller can go live.</li>
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
        {BRAND.appName} itself requires a Central FSSAI e-commerce license before commercial (live,
        non-mock) operations begin.
      </p>
    </>
  );
}
