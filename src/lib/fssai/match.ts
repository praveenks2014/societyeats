/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — a deliberately conservative
 * fuzzy match between a verification adapter's returned licensee name and a
 * seller's own identity (their account name or kitchen name), used to
 * decide whether an "enter it anytime" submission (src/app/api/fssai/verify/
 * route.ts) can auto-verify or needs a human on /admin/fssai. Token-overlap,
 * not a fuzzy-string-distance library — no such dependency exists anywhere
 * in this codebase, and a simple, auditable rule is easier to reason about
 * for something that gates an auto-verify decision. In MOCK_MODE (the
 * pilot's default), src/lib/fssai/verify.ts's mock adapter returns a name
 * from a small fixed list uncorrelated with the real seller — so most
 * mock-mode submissions will legitimately fall through to the admin queue,
 * same as most real submissions would in practice (auto-match is the
 * exception, not the rule).
 */
function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** True if `candidate` shares at least one meaningful (3+ char) word with any of `targets`. */
export function fuzzyNameMatch(candidate: string, targets: string[]): boolean {
  const candidateTokens = new Set(normalizeTokens(candidate));
  if (candidateTokens.size === 0) return false;
  return targets.some((target) => normalizeTokens(target).some((t) => candidateTokens.has(t)));
}
