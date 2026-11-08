import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { BRAND, brandText } from '@/config/brand';

describe('B1: one source of truth for the brand', () => {
  test('the brand is derived from brand.json and its identifiers follow it', () => {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/config/brand.json'), 'utf8')) as { name: string; slug: string; shortCode: string; tagline: string };
    expect(BRAND.name).toBe(j.name);
    expect(BRAND.slug).toBe(j.slug);
    expect(BRAND.tagline).toBe(j.tagline);
    expect(BRAND.receiptPrefix).toBe(`${j.shortCode.toLowerCase()}-`);
    expect(BRAND.invoicePrefix).toBe(j.shortCode);
    expect(BRAND.cookieName).toBe(`${j.slug}_session`);
    expect(BRAND.storageKey('cart')).toBe(`${j.slug}_cart`);
    expect(BRAND.legacySlugs.length).toBeGreaterThan(0);
  });

  test('seeded text uses {{brand}} / {{slug}} and resolves from the brand', () => {
    expect(brandText('Welcome to {{brand}} ({{slug}})')).toBe(`Welcome to ${BRAND.name} (${BRAND.slug})`);
  });

  test('the generated manifest is the brand (name, short name, tagline)', async () => {
    const { default: manifest } = await import('@/app/manifest');
    const m = manifest();
    expect(m).toMatchObject({ name: BRAND.name, short_name: BRAND.shortName, description: BRAND.tagline });
  });

  test('the service-worker stamp writes the brand name and a slug-prefixed cache name', () => {
    const out = execSync('node scripts/gen-sw.mjs', { cwd: process.cwd(), encoding: 'utf8' });
    expect(out).toContain(`"${BRAND.slug}-v`);
    const sw = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
    expect(sw).toContain(BRAND.name);
    expect(sw).not.toContain('__BRAND_NAME__');
    expect(sw).not.toContain('__SW_CACHE_VERSION__');
  });
});
