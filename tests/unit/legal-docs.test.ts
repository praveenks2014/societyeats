import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useTestDb } from '../helpers/db';
import { makeUser } from '../helpers/fixtures';
import { LEGAL_SLUGS, SEED_DOCS } from '@/lib/legal/seed-docs';
import { fillLegal, renderMarkdown } from '@/lib/legal/render';
import { recordConsent } from '@/lib/consent';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
beforeAll(async () => {
  db = await useTestDb();
});

describe('legal documents seed', () => {
  test('ten documents, none empty, all placeholders known', async () => {
    expect(LEGAL_SLUGS).toHaveLength(10);
    expect(SEED_DOCS.map((d) => d.slug).sort()).toEqual([...LEGAL_SLUGS].sort());
    const { legalVars } = await import('@/lib/legal/render');
    const { getPlatformSettings } = await import('@/lib/db/platform');
    const vars = legalVars(await getPlatformSettings());
    for (const d of SEED_DOCS) {
      expect(d.body.length).toBeGreaterThan(200);
      const missing = (fillLegal(d.body, vars).match(/\{\{\w+\}\}/g) ?? []);
      expect(missing, `${d.slug} has unknown placeholders`).toEqual([]);
    }
  });
  test('the terms describe pay-at-door, not the old hand-over code', () => {
    const t = SEED_DOCS.find((d) => d.slug === 'terms')!.body;
    expect(t).toMatch(/at your door/);
    expect(t).not.toMatch(/4-digit code/);
  });
  test('terms and kitchen-terms carry their disclaimers', () => {
    const src = readFileSync('src/app/legal/[slug]/page.tsx', 'utf8');
    expect(src).toMatch(/terms: \[[^\]]*'off-platform'[^\]]*'liability'/);
    expect(src).toMatch(/'kitchen-terms': \[[^\]]*'tax-seller'/);
  });
});

describe('markdown renderer', () => {
  test('headings, anchors, lists, bold and safe links; raw HTML is escaped', () => {
    const html = renderToStaticMarkup(renderMarkdown('# T\n\n## Liability {#liability}\n- one **two**\n- [go](/legal/terms)\n\n<script>alert(1)</script> [x](javascript:alert(1))'));
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<h2 id="liability">Liability</h2>');
    expect(html).toContain('<strong>two</strong>');
    expect(html).toContain('href="/legal/terms"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
  });
});

describe('versioning, review status and re-consent', () => {
  test('publish bumps the version, resets review, and only a material change asks users again', async () => {
    const docs = await import('@/lib/legal/docs');
    await docs.seedLegalDocuments();
    expect(await docs.seedLegalDocuments()).toBe(0);
    const admin = await makeUser(db, 'admin');
    const buyer = await makeUser(db, 'buyer');
    const v1 = await docs.currentConsentLabel('terms');
    expect(v1).toBe('2026-11-draft1');
    await recordConsent(buyer.id, 'terms', v1);
    await recordConsent(buyer.id, 'privacy', await docs.currentConsentLabel('privacy'));
    expect(await docs.pendingReconsent(buyer.id, 'buyer')).toEqual([]);

    await docs.markLegalReviewed('terms', admin.id);
    expect((await docs.getLegalDocument('terms'))!.reviewStatus).toBe('reviewed');

    // a minor edit: new version, back to draft, nobody is asked again
    const base = (await docs.getLegalDocument('terms'))!.body;
    expect(await docs.publishLegalDocument('terms', { title: 'Terms of Use', body: base + '\n\nA small clarification added here for the test.', material: false, changeSummary: 'Typo' }, admin.id)).toBe(2);
    expect((await docs.getLegalDocument('terms'))!.reviewStatus).toBe('draft');
    expect(await docs.pendingReconsent(buyer.id, 'buyer')).toEqual([]);

    // a material edit: everyone who accepted an earlier version is asked
    expect(await docs.publishLegalDocument('terms', { title: 'Terms of Use', body: base + '\n\nA material change that needs consent again.', material: true, changeSummary: 'New cancellation rule' }, admin.id)).toBe(3);
    const pending = await docs.pendingReconsent(buyer.id, 'buyer');
    expect(pending.map((p) => [p.slug, p.label, p.changeSummary])).toEqual([['terms', 'v3', 'New cancellation rule']]);
    // a user who never accepted anything (no consent row) is not nagged; a seller-only doc is not asked of a buyer
    const stranger = await makeUser(db, 'buyer');
    expect((await docs.pendingReconsent(stranger.id, 'buyer')).length).toBe(0);

    expect(await docs.acceptReconsent(buyer.id, 'buyer', ['terms'])).toBe(1);
    expect(await docs.pendingReconsent(buyer.id, 'buyer')).toEqual([]);
    expect((await docs.legalVersions('terms')).map((v) => v.version)).toEqual([3, 2, 1]);
    // an identical publish is a no-op
    expect(await docs.publishLegalDocument('terms', { title: 'Terms of Use', body: base + '\n\nA material change that needs consent again.', material: true, changeSummary: 'again' }, admin.id)).toBe(3);
  });
  test('publishing demands a change summary', async () => {
    const docs = await import('@/lib/legal/docs');
    const admin = await makeUser(db, 'admin');
    await expect(docs.publishLegalDocument('privacy', { title: 'Privacy Notice', body: 'x'.repeat(100), material: false, changeSummary: ' ' }, admin.id)).rejects.toThrow(/what changed/i);
  });
});
