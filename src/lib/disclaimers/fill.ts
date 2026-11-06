export function fillDisclaimer(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{([^}]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
