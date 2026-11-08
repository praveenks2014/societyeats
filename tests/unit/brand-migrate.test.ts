import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { BRAND } from '@/config/brand';
import { renameBrandText, renameSeededBrandText } from '@/lib/brand-migrate';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  db = await useTestDb();
});
const OLD_NAME = BRAND.legacyNames[0];
const OLD_SLUG = BRAND.legacySlugs[0];

describe('B1/B4: seeded text follows the brand', () => {
  test('a fresh database seeds disclaimers and legal documents with the new name and no placeholder or earlier name', async () => {
    const { seedDisclaimers, listDisclaimers } = await import('@/lib/disclaimers');
    const { seedLegalDocuments, listLegalDocuments } = await import('@/lib/legal/docs');
    await seedDisclaimers();
    await seedLegalDocuments();
    const texts = (await listDisclaimers()).map((d) => d.text);
    expect(texts.some((t) => t.includes(BRAND.name))).toBe(true);
    for (const t of texts) {
      expect(t).not.toContain('{{');
      expect(t).not.toContain(OLD_NAME);
    }
    // legal documents are written with {{appName}} and friends, which are filled from the brand when a page is rendered
    for (const d of await listLegalDocuments()) expect(d.body).not.toContain(OLD_NAME);
  });

  test('renameBrandText swaps the name and the slug and is idempotent', () => {
    const t = `${OLD_NAME} is at https://${OLD_SLUG}.example`;
    expect(renameBrandText(t)).toBe(`${BRAND.name} is at https://${BRAND.slug}.example`);
    expect(renameBrandText(renameBrandText(t))).toBe(renameBrandText(t));
    expect(renameBrandText(null)).toBeNull();
  });

  test('a database seeded under the earlier name is updated, but text an admin edited is left alone', async () => {
    await db.update(s.disclaimers).set({ text: `${OLD_NAME} is an online marketplace.`, version: 1 }).where(eq(s.disclaimers.id, 'marketplace'));
    await db.update(s.disclaimerVersions).set({ text: `${OLD_NAME} is an online marketplace.` }).where(eq(s.disclaimerVersions.disclaimerId, 'marketplace'));
    await db.update(s.disclaimers).set({ text: `${OLD_NAME} wrote this wording itself.`, version: 2 }).where(eq(s.disclaimers.id, 'pilot'));
    await db.update(s.fssaiWalkthroughSteps).set({ body: `${OLD_NAME} checks it by hand.` }).where(eq(s.fssaiWalkthroughSteps.id, (await db.select().from(s.fssaiWalkthroughSteps))[0]?.id ?? 0)).catch(() => {});
    const r = await renameSeededBrandText(db);
    expect(r.disclaimers).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(s.disclaimers).where(eq(s.disclaimers.id, 'marketplace')))[0].text).toBe(`${BRAND.name} is an online marketplace.`);
    expect((await db.select().from(s.disclaimerVersions).where(eq(s.disclaimerVersions.disclaimerId, 'marketplace')))[0].text).toBe(`${BRAND.name} is an online marketplace.`);
    expect((await db.select().from(s.disclaimers).where(eq(s.disclaimers.id, 'pilot')))[0].text).toBe(`${OLD_NAME} wrote this wording itself.`); // version 2: an admin's text
    expect(await renameSeededBrandText(db)).toEqual({ disclaimers: 0, fssaiSteps: 0 }); // idempotent
  });
});
