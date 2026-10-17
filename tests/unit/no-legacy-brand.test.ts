import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

// The old name belongs to another entity and must never reappear. The needle
// is built from two halves so this very file does not trip the scan.
const NEEDLE = new RegExp('ghar' + 'se', 'i');
const ROOT = process.cwd();
const TEXT_EXT = /\.(tsx?|mjs|cjs|js|json|webmanifest|svg|css|md|html|txt|sql|ya?ml)$/i;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'uploads') continue;
      walk(p, out);
    } else if (TEXT_EXT.test(e.name)) out.push(p);
  }
  return out;
}

test('legacy brand name does not appear in src/, public/, scripts/, package.json or the manifest', () => {
  const files = [
    ...walk(path.join(ROOT, 'src')),
    ...walk(path.join(ROOT, 'public')),
    ...walk(path.join(ROOT, 'scripts')),
    ...walk(path.join(ROOT, 'tests')),
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'public', 'manifest.webmanifest'),
  ].filter((f) => !f.endsWith('no-legacy-brand.test.ts') && !f.endsWith(path.join('public', 'sw.js')));
  const offenders = files.filter((f) => NEEDLE.test(fs.readFileSync(f, 'utf8')));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});

test('BRAND is the single source for the app name', async () => {
  const { BRAND } = await import('@/config/brand');
  expect(BRAND.appName).toBe('PadosiPlate');
  expect(BRAND.cookieName).toBe('padosi_session');
  expect(BRAND.receiptPrefix).toBe('pp_');
});
