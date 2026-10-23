import { expect, test } from '@playwright/test';

/** 390px smoke checks: no horizontal overflow, 44px touch targets on the main public pages. */
const PUBLIC_PAGES = ['/', '/login', '/register', '/join/E2E-ONE', '/legal/terms', '/legal/refunds', '/forgot-password'];

for (const path of PUBLIC_PAGES) {
  test(`mobile layout: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal scroll').toBeLessThanOrEqual(1);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), select')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ el: el.tagName + (el.textContent ?? '').trim().slice(0, 24), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
        .filter((x) => x.h > 0 && x.h < 36 && x.w > 0),
    );
    expect(small, `small touch targets on ${path}`).toEqual([]);
  });
}
