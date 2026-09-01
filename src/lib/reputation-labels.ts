/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). Display labels for src/lib/reputation.ts's sellerBadgeTier() —
 * split into its own client-safe module (no `getDb`/DB-driver imports) so
 * client components (kitchen-client.tsx, dish-detail.tsx) can render the
 * label without pulling server-only code into the browser bundle.
 */
export const BADGE_TIER_LABEL: Record<number, string> = {
  10: '🏅 10+ orders cooked',
  50: '🏅 50+ orders cooked',
  100: '🥇 100+ orders cooked',
};
