import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { DISCLAIMER_DEFAULTS, DISCLAIMER_IDS } from '@/lib/disclaimers/defs';
import { fillDisclaimer } from '@/lib/disclaimers/fill';
import { useTestDb } from '../helpers/db';

vi.mock('next/headers', () => import('../helpers/next-headers'));

/** Where each disclaimer must render (source files that contain `<Disclaimer id="…">` / `<DisclaimerClient id="…">`). */
const LOCATIONS: Record<string, string[]> = {
  marketplace: ['src/components/site-footer.tsx', 'src/app/register/page.tsx', 'src/app/kitchen/[id]/page.tsx'],
  'home-kitchen': ['src/components/dish-facts.tsx', 'src/app/cart/page.tsx'],
  'fssai-provisional': ['src/components/dish-facts.tsx', 'src/app/kitchen/[id]/page.tsx'],
  allergens: ['src/components/dish-facts.tsx', 'src/app/cart/page.tsx'],
  'veg-mark': ['src/components/dish-facts.tsx'],
  'consume-by': ['src/components/dish-facts.tsx', 'src/app/orders/[id]/invoice/invoice-client.tsx'],
  pricing: ['src/components/browse.tsx', 'src/app/cart/page.tsx', 'src/app/checkout/checkout-client.tsx', 'src/app/dish/[id]/page.tsx'],
  'pay-at-door': ['src/app/checkout/checkout-client.tsx', 'src/app/orders/[id]/order-detail.tsx'],
  'qr-check': ['src/components/order-extras.tsx'],
  'off-platform': ['src/app/orders/[id]/order-detail.tsx'],
  cancellation: ['src/app/checkout/checkout-client.tsx', 'src/app/orders/[id]/order-detail.tsx'],
  'fssai-help': ['src/components/fssai-wizard.tsx'],
  'tax-seller': ['src/app/seller/earnings/page.tsx'],
  health: ['src/components/site-footer.tsx', 'src/components/dish-facts.tsx'],
  chat: ['src/components/order-extras.tsx'],
  community: ['src/app/join/[code]/page.tsx'],
  pilot: ['src/components/pilot-banner.tsx'],
};

describe('disclaimers', () => {
  test('there are exactly 18, each with non-empty text', () => {
    expect(DISCLAIMER_IDS).toHaveLength(18);
    for (const id of DISCLAIMER_IDS) expect(DISCLAIMER_DEFAULTS[id].length).toBeGreaterThan(20);
  });
  test.each(Object.entries(LOCATIONS))('%s renders in every listed location', (id, files) => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} should render disclaimer ${id}`).toMatch(new RegExp(`<Disclaimer(Client)?\\s[^>]*id="${id}"`));
    }
  });
  test('placeholders are filled; unknown ones are left visible', () => {
    expect(fillDisclaimer(DISCLAIMER_DEFAULTS['consume-by'], { N: 6 })).toBe('Best consumed within 6 hours of delivery. Refrigerate leftovers promptly.');
    expect(fillDisclaimer(DISCLAIMER_DEFAULTS['qr-check'], { 'registered name': 'ASHA K' })).toContain('**ASHA K**');
    expect(fillDisclaimer('Hello {X}', {})).toBe('Hello {X}');
  });
});

describe('disclaimers in the database', () => {
  let db: Awaited<ReturnType<typeof useTestDb>>;
  beforeAll(async () => {
    db = await useTestDb();
  });
  test('seed is idempotent and never overwrites an admin edit; edits are versioned', async () => {
    const { seedDisclaimers, getDisclaimerText, updateDisclaimer, disclaimerHistory, listDisclaimers } = await import('@/lib/disclaimers');
    const { makeUser } = await import('../helpers/fixtures');
    expect(await seedDisclaimers()).toBe(18);
    expect(await seedDisclaimers()).toBe(0);
    const admin = await makeUser(db, 'admin');
    const v = await updateDisclaimer('pilot', 'Pilot notice: edited by the admin for the test.', admin.id);
    expect(v).toBe(2);
    expect(await seedDisclaimers()).toBe(0);
    expect(await getDisclaimerText('pilot')).toContain('edited by the admin');
    expect((await disclaimerHistory('pilot')).map((h) => h.version)).toEqual([2, 1]);
    expect(await updateDisclaimer('pilot', 'Pilot notice: edited by the admin for the test.', admin.id)).toBe(2); // no-op
    expect((await listDisclaimers()).find((d) => d.id === 'pilot')?.version).toBe(2);
    await expect(updateDisclaimer('pilot', 'short', admin.id)).rejects.toThrow();
  });
});
