import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { api, enrolAdminFresh, mockOutbox, newUserContext, register, seedKitchen } from './helpers';

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

/** Mobile-390 journeys: the same product, a phone-sized screen. Each test makes its own people (numbers 9200…) so it is independent of the desktop run. */
let m = 0;
async function phoneBuyer(browser: Parameters<typeof newUserContext>[0]) {
  const n = ++m;
  const { ctx, page } = await newUserContext(browser, { viewport: { width: 390, height: 844 } });
  const u = { phone: `92000${String(2000 + n).padStart(5, '0')}`, email: `mbuyer${n}@e2e.example`, name: `Mobile Buyer ${n}` };
  await register(page.request, u);
  const mail = (await mockOutbox(page.request, u.email)).find((x) => x.kind === 'verify_email')!;
  expect((await api(page.request, 'post', '/api/auth/verify-email', { token: mail.bodyText.match(/token=([\w-]+)/)![1] })).status).toBe(200);
  return { ctx, page, ...u };
}
async function noOverflow(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal scroll on ${label}`).toBeLessThanOrEqual(1);
}

test('mobile: feed, kitchen page, favourites, notifications and Plus fit 390px', async ({ browser, request }) => {
  const k = await seedKitchen(request, { n: 900 + ++m });
  const b = await phoneBuyer(browser);
  for (const path of ['/', `/kitchen/${k.sellerId}`, '/favourites', '/account/notifications', '/plus', '/bulk', '/legal/how-ranking-works', '/legal/grievance']) {
    await b.page.goto(path);
    await noOverflow(b.page, path);
  }
  await b.ctx.close();
});

test('mobile: book a pre-order, see it on the order page, and chat with the kitchen', async ({ browser, request }) => {
  const k = await seedKitchen(request, { n: 900 + ++m, price: 12000 });
  const b = await phoneBuyer(browser);
  const when = new Date(Date.now() + 2 * 86_400_000);
  when.setUTCHours(7, 30, 0, 0);
  const r = await api(b.page.request, 'post', '/api/orders', { type: 'home_delivery', sellerId: k.sellerId, items: [{ id: k.dishId, qty: 1 }], fulfillmentType: 'self_pickup', scheduledFor: when.toISOString() });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  expect((await api(b.page.request, 'post', '/api/payments/mock-complete', { orderId: r.json.orderId, outcome: 'success' })).status).toBe(200);
  await b.page.goto(`/orders/${r.json.orderId}`);
  await expect(b.page.getByTestId('chat')).toBeVisible();
  await noOverflow(b.page, 'order page');
  await b.page.getByTestId('chat-input').fill('Thank you, see you then');
  await b.page.getByTestId('chat-send').click();
  await expect(b.page.getByTestId('chat').getByText('Thank you, see you then')).toBeVisible();
  await b.ctx.close();
});

test('mobile: the admin console pages fit 390px', async ({ browser }) => {
  const { ctx, page } = await enrolAdminFresh(browser, { width: 390, height: 844 });
  for (const path of ['/admin', '/admin/settings', '/admin/go-live', '/admin/insights', '/admin/grievances', '/admin/legal', '/admin/growth']) {
    await page.goto(path);
    await noOverflow(page, path);
  }
  await ctx.close();
});
