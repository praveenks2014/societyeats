/**
 * Shared constants for the complaint flow (DECISIONS.md #73+), used by both
 * the buyer-facing "report an issue" form and the admin resolution queue —
 * kept here once rather than duplicated in each client component.
 */

export type ComplaintCategory = 'quality' | 'wrong_item' | 'hygiene' | 'not_received';
export type ComplaintOutcome = 'full_refund' | 'partial_refund' | 'warning' | 'seller_paused' | 'rejected';

export const COMPLAINT_CATEGORIES: { value: ComplaintCategory; label: string }[] = [
  { value: 'quality', label: 'Food quality' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'hygiene', label: 'Hygiene' },
  { value: 'not_received', label: 'Never received' },
];

export const COMPLAINT_OUTCOME_LABELS: Record<ComplaintOutcome, string> = {
  full_refund: 'Full refund',
  partial_refund: 'Partial refund',
  warning: 'Warning to seller',
  seller_paused: 'Seller paused',
  rejected: 'Rejected — no fault found',
};

/** Every outcome except 'rejected' counts as the admin upholding the complaint. */
export function isUpheldOutcome(outcome: ComplaintOutcome | null): boolean {
  return outcome != null && outcome !== 'rejected';
}
