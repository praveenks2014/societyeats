import { allergensToColumns, checkDishText, isVegFromMark, validatePackaged, type FoodMark } from '@/lib/dishes/rules';
import { ApiError } from '@/lib/api';

type RulesInput = {
  title: string;
  description?: string | null;
  cuisine?: string | null;
  foodMark: FoodMark;
  ingredients: string;
  allergens: string[];
  spiceLevel?: string | null;
  portionSize?: string | null;
  bestWithinHours?: number | null;
  storageAdvice?: string | null;
  leadTimeDays?: number;
  maxPortionsPerSlot?: number | null;
  photos?: string[];
  isPackaged?: boolean;
  packaged?: unknown;
};

/** Validates the prohibited-item and packaged-food rules and returns the DB columns. Throws a 400 with the reason. */
export function dishRuleColumns(body: RulesInput, s: { prohibitedKeywords: string; packagedFoodsEnabled: boolean }) {
  const text = checkDishText(body, s.prohibitedKeywords);
  if (text.blockedReason) throw new ApiError(400, text.blockedReason);
  const pkgErr = validatePackaged(!!body.isPackaged, body.packaged, s.packagedFoodsEnabled);
  if (pkgErr) throw new ApiError(400, pkgErr);
  return {
    healthClaim: text.healthClaim,
    columns: {
      foodMark: body.foodMark,
      isVeg: isVegFromMark(body.foodMark),
      ingredients: body.ingredients,
      ...allergensToColumns(body.allergens),
      spiceLevel: body.spiceLevel ?? null,
      portionSize: body.portionSize ?? null,
      bestWithinHours: body.bestWithinHours ?? null,
      storageAdvice: body.storageAdvice ?? null,
      leadTimeDays: body.leadTimeDays ?? 0,
      maxPortionsPerSlot: body.maxPortionsPerSlot ?? null,
      photosJson: body.photos ?? null,
      isPackaged: !!body.isPackaged,
      packagedJson: body.isPackaged ? (body.packaged as never) : null,
    },
  };
}
