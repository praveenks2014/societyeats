import { Disclaimer } from '@/components/disclaimer';
import { checkDishText } from '@/lib/dishes/rules';

const MARK = { veg: ['🟢', 'Vegetarian'], egg: ['🟡', 'Contains egg'], non_veg: ['🔴', 'Non-vegetarian'] } as const;

type Facts = {
  foodMark: string;
  ingredients: string | null;
  allergensJson: string[] | null;
  allergensDeclared: boolean;
  spiceLevel: string | null;
  portionSize: string | null;
  bestWithinHours: number | null;
  storageAdvice: string | null;
  title: string;
  description: string | null;
};

/** What a buyer needs to know before ordering, plus the disclaimers that belong with it. Server component. */
export function DishFacts({ listing, provisional }: { listing: Facts; provisional: boolean }) {
  const [dot, label] = MARK[listing.foodMark as keyof typeof MARK] ?? MARK.veg;
  const allergens = listing.allergensDeclared ? (listing.allergensJson?.length ? listing.allergensJson.join(', ') : 'None declared by the kitchen') : 'Not declared by the kitchen';
  const healthWords = !!checkDishText({ title: listing.title, description: listing.description, ingredients: listing.ingredients }).healthClaim;
  return (
    <section className="mt-5 space-y-3" data-testid="dish-facts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-card border border-rice-line bg-white p-3 text-sm">
        <dt className="text-ink-faint">Food mark</dt>
        <dd data-testid="food-mark">{dot} {label}</dd>
        {listing.ingredients && (<><dt className="text-ink-faint">Ingredients</dt><dd>{listing.ingredients}</dd></>)}
        <dt className="text-ink-faint">Allergens</dt>
        <dd data-testid="allergens">{allergens}</dd>
        {listing.spiceLevel && (<><dt className="text-ink-faint">Spice</dt><dd className="capitalize">{listing.spiceLevel}</dd></>)}
        {listing.portionSize && (<><dt className="text-ink-faint">Portion</dt><dd>{listing.portionSize}</dd></>)}
        {listing.storageAdvice && (<><dt className="text-ink-faint">Storage</dt><dd>{listing.storageAdvice}</dd></>)}
      </dl>
      <Disclaimer id="veg-mark" />
      <Disclaimer id="allergens" />
      <Disclaimer id="home-kitchen" />
      {listing.bestWithinHours ? <Disclaimer id="consume-by" vars={{ N: listing.bestWithinHours }} /> : null}
      {provisional && <Disclaimer id="fssai-provisional" />}
      {healthWords && <Disclaimer id="health" />}
    </section>
  );
}
