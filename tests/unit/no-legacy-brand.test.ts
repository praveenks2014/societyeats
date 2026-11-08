import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

// Earlier product names must not appear outside the places that record history or compatibility. The needles are built from halves so this
// very file does not trip the scan.
const OLDEST = new RegExp('ghar' + 'se', 'i');
const PREVIOUS = [new RegExp('Padosi' + 'Plate', 'i'), new RegExp('padosi' + '_', 'i')];
const ROOT = process.cwd();
const ALLOWED = [
  'src/config/brand.ts', // legacySlugs / legacyNames / legacy prefixes: the compatibility list
  'DECISIONS.md', // history
  'tests/unit/no-legacy-brand.test.ts',
];
const TEXT_EXT = /\.(tsx?|mjs|cjs|js|json|webmanifest|svg|css|md|html|txt|ya?ml|sh|env|example)$|^\.(env\.example|replit)$/i;

function trackedTextFiles(): string[] {
  return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('drizzle/') && !ALLOWED.includes(f))
    .filter((f) => TEXT_EXT.test(path.basename(f)) || path.basename(f).startsWith('.'))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

test('the product name before this one does not appear anywhere in the repo', () => {
  const offenders = trackedTextFiles().filter((f) => f !== 'docs/AUDIT.md' /* a dated audit of the original code */).filter((f) => OLDEST.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(offenders).toEqual([]);
});

test('the previous brand spellings (name, slug, key prefix) appear only in brand.ts, DECISIONS.md and the migrations', () => {
  const hits: string[] = [];
  for (const f of trackedTextFiles()) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const re of PREVIOUS) if (re.test(text)) hits.push(`${f} (${re.source})`);
  }
  expect(hits).toEqual([]);
});

test('BRAND is the single source for the app name and its identifiers', async () => {
  const { BRAND } = await import('@/config/brand');
  expect(BRAND.name).toBe('Kootu');
  expect(BRAND.appName).toBe(BRAND.name);
  expect(BRAND.cookieName).toBe('kootu_session');
  expect(BRAND.receiptPrefix).toBe('kt-');
  expect(BRAND.invoicePrefix).toBe('KT');
  expect(BRAND.tagline).toBe('Homemade, by neighbours');
});
