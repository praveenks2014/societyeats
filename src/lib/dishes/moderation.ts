/**
 * Dish moderation. When `dishModerationEnabled`, a dish waits for admin
 * approval when it is new, or when its name or photos change, or its price
 * moves by more than 30% from what the admin last approved.
 */
export const PRICE_CHANGE_THRESHOLD = 0.3;

export type DishSnapshot = { title: string; photoUrl: string | null; priceInPaise: number };

export function needsReReview(approved: DishSnapshot | null | undefined, next: DishSnapshot): boolean {
  if (!approved) return true;
  if (approved.title.trim().toLowerCase() !== next.title.trim().toLowerCase()) return true;
  if ((approved.photoUrl ?? null) !== (next.photoUrl ?? null)) return true;
  if (approved.priceInPaise <= 0) return true;
  const change = Math.abs(next.priceInPaise - approved.priceInPaise) / approved.priceInPaise;
  return change > PRICE_CHANGE_THRESHOLD;
}

export function moderationOnCreate(moderationEnabled: boolean): 'pending' | 'approved' {
  return moderationEnabled ? 'pending' : 'approved';
}

/** Status after a seller edit: unchanged unless the edit crosses a threshold (hidden dishes stay hidden). */
export function moderationAfterEdit(
  current: string,
  approved: DishSnapshot | null | undefined,
  next: DishSnapshot,
  moderationEnabled: boolean,
): 'pending' | 'approved' | 'rejected' | 'hidden' {
  if (current === 'hidden') return 'hidden';
  if (!moderationEnabled) return current === 'pending' || current === 'rejected' ? 'approved' : (current as 'approved');
  if (current === 'rejected') return 'pending'; // seller fixed and re-saved → back to review
  if (current === 'pending') return 'pending';
  return needsReReview(approved, next) ? 'pending' : 'approved';
}
