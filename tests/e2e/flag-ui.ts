import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { adminSession, api, login, newUserContext, seedKitchen } from './helpers';

/**
 * Scenario 23 (UI part): with the flags switched on by an admin, the Sponsored feed card and the meal-plan screens (kitchen create/edit/pause,
 * buyer book/skip/pause) work end to end; switched off they disappear. Shared by the desktop and the 390px projects.
 * `buyer` is a signed-in resident of the E2E-ONE society.
 */
export async function flagUiJourney(o: { browser: Browser; request: APIRequestContext; buyer: Page; kitchenNo: number; viewport?: { width: number; height: number } }) {
  const { browser, request, buyer, viewport } = o;
  const noOverflow = async (page: Page, label: string) => {
    if (!viewport) return;
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal scroll on ${label}`).toBeLessThanOrEqual(1);
  };
  const { ctx: actx, page: admin } = await adminSession(browser, viewport);
  const patch = async (p: Record<string, unknown>, reason: string) => expect((await api(admin.request, 'patch', '/api/admin/settings', { ...p, reason })).status).toBe(200);
  try {
    // off by default: no Sponsored card, no meal-plan section
    const k = await seedKitchen(request, { n: o.kitchenNo, price: 9000, qty: 50 });
    await buyer.goto(`/kitchen/${k.sellerId}`);
    await expect(buyer.getByTestId('meal-plans')).toHaveCount(0);
    await buyer.goto('/');
    await expect(buyer.getByTestId('sponsored-card')).toHaveCount(0);

    await patch({ mealPlansEnabled: true, featuredEnabled: true, preOrderMaxDays: 14 }, 'e2e: switch meal plans and sponsored on');

    // Sponsored: labelled, linked to the explanation, separate from the ranked list
    const societyId = (await api(buyer.request, 'get', '/api/auth/me')).json.session.societyId as number;
    const placed = await api(admin.request, 'post', '/api/admin/featured', { sellerId: k.sellerId, societyId, startsOn: '2026-01-01', endsOn: '2099-01-01' });
    expect(placed.status, JSON.stringify(placed.json)).toBe(200);
    await buyer.goto('/');
    const card = buyer.getByTestId('sponsored-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('sponsored-label')).toHaveText('SPONSORED');
    await expect(card.getByTestId('sponsored-why')).toHaveAttribute('href', '/legal/how-ranking-works#sponsored');
    await expect(buyer.getByTestId('sponsored-card')).toHaveCount(1); // at most one
    await noOverflow(buyer, 'feed with a Sponsored card');
    await buyer.goto('/legal/how-ranking-works');
    await expect(buyer.locator('#sponsored')).toBeAttached();

    // the kitchen creates a plan from its screen
    const { ctx: sctx, page: seller } = await newUserContext(browser, { viewport });
    await login(seller.request, k.email);
    await seller.goto('/seller/plans');
    await expect(seller.getByTestId('seller-plans')).toBeVisible();
    await seller.getByTestId('plan-name').fill('Weekday lunch box');
    for (const d of ['sat', 'sun']) await seller.getByTestId(`plan-day-${d}`).click(); // every day, so a week always has days
    await seller.getByTestId(`plan-dish-${k.dishId}`).click();
    await seller.getByTestId('plan-save').click();
    const planRow = seller.getByTestId('plan-list').locator('[data-testid^="seller-plan-"]').first();
    await expect(planRow).toContainText('Weekday lunch box');
    await noOverflow(seller, 'seller meal plans');
    const planId = Number((await planRow.getAttribute('data-testid'))!.replace('seller-plan-', ''));

    // edit it (name), then the buyer books a week from the kitchen page
    await planRow.getByTestId(`plan-edit-${planId}`).click();
    await seller.getByTestId('plan-name').fill('Weekday lunch box (veg)');
    await seller.getByTestId('plan-save').click();
    await expect(seller.getByTestId(`seller-plan-${planId}`)).toContainText('(veg)');

    await buyer.goto(`/kitchen/${k.sellerId}`);
    await expect(buyer.getByTestId(`plan-${planId}`)).toContainText('(veg)');
    await buyer.getByTestId(`plan-book-${planId}`).click();
    const mine = buyer.getByTestId('my-plans');
    await expect(mine).toBeVisible({ timeout: 20_000 });
    await noOverflow(buyer, 'kitchen page with meal plans');
    const sub = mine.locator('[data-testid^="sub-"][data-status="active"]').first();
    await expect(sub).toBeVisible();

    // skip one day: it shows as cancelled; then pause the rest
    const skip = sub.locator('[data-testid^="skip-"]').first();
    const skippedId = (await skip.getAttribute('data-testid'))!.replace('skip-', '');
    await skip.click();
    await expect(buyer.getByTestId(`sub-day-${skippedId}`)).toContainText(/cancelled/i, { timeout: 15_000 });
    await sub.locator('[data-testid^="pause-"]').click();
    await expect(mine.locator('[data-testid^="sub-"]').first()).toHaveAttribute('data-status', 'paused', { timeout: 15_000 });
    await buyer.goto('/plans');
    await expect(buyer.getByTestId('my-plans')).toBeVisible();
    await noOverflow(buyer, 'my plans');

    // the kitchen pauses the plan: buyers no longer see it to book
    await seller.goto('/seller/plans');
    await seller.getByTestId(`plan-toggle-${planId}`).click();
    await expect(seller.getByTestId(`seller-plan-${planId}`)).toHaveAttribute('data-active', 'false');
    await buyer.goto(`/kitchen/${k.sellerId}`);
    await expect(buyer.getByTestId(`plan-${planId}`)).toHaveCount(0);
    await sctx.close();

    // off again: both vanish
    await patch({ mealPlansEnabled: false, featuredEnabled: false }, 'e2e: back to the pilot defaults');
    await buyer.goto('/');
    await expect(buyer.getByTestId('sponsored-card')).toHaveCount(0);
    expect((await api(buyer.request, 'get', '/api/meal-plans')).status).toBe(404);
  } finally {
    await actx.close();
  }
}
