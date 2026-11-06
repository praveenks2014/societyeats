/**
 * PAN name ↔ UPI registered name similarity, 0–100. Normalised and token-based so "KAMALA DEVI" matches
 * "Devi Kamala", "K. Devi" and "Smt Kamala Devi" well, and a stranger's name does not. A low score FLAGS the
 * kitchen for an admin; it never rejects anyone on its own.
 */
const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'SMT', 'SMTH', 'SHRI', 'SRI', 'SHREE', 'DR', 'LATE', 'MD', 'MOHD', 'W/O', 'D/O', 'S/O']);

export function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** 1 for identical, ~0.6 for an initial vs a full name, else an edit-distance ratio. */
function tokenScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.6 : 0;
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return ratio >= 0.7 ? ratio : 0;
}

export function nameMatchScore(a: string | null | undefined, b: string | null | undefined): number {
  const ta = nameTokens(a ?? '');
  const tb = nameTokens(b ?? '');
  if (!ta.length || !tb.length) return 0;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  for (const t of small) {
    let best = 0;
    let bestIdx = -1;
    large.forEach((u, i) => {
      if (used.has(i)) return;
      const s = tokenScore(t, u);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  // Penalise extra unmatched tokens a little, so "RAVI" does not score 100 against "RAVI KUMAR REDDY SHARMA".
  const coverage = small.length / large.length;
  return Math.round((total / small.length) * 100 * (0.8 + 0.2 * coverage));
}
