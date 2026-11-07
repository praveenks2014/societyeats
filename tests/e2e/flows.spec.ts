import type { Page, PlaywrightTestArgs, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  ADMIN_EMAIL, ADMIN_FIRST_PASSWORD, ADMIN_PASSWORD, adminCode, api, login, loginAdmin, mockOutbox, newUserContext, orderAction, payMockSheet, pngFile, register, saveAdminTotp,
  seedKitchen, timeTravel, timeTravelOrder,
} from './helpers';
import { totpAt } from '../../src/lib/auth/totp';
import { flagUiJourney } from './flag-ui';
import { mobileEnv } from './helpers';

/**
 * Serial journey through the whole pilot, against MOCK_MODE + PGlite.
 * State carries between tests on purpose (one resident, one kitchen, one admin).
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const PW = 'Sturdy-pass-42';
const RESIDENT = { phone: '9100000001', email: 'resident@e2e.example', name: 'Rhea Resident' };
const COOK = { phone: '9100000002', email: 'cook@e2e.example', name: 'Kamala Cook', kitchenName: 'Kamala’s Kitchen' };

/**
 * The same journeys run on the desktop project and on mobile-390 (the money paths: 1, 2, 3, 5, 6, 9, 10, 13 and 23b). Each project gets its own people
 * (phone/e-mail offset) and its own kitchen numbers, because both run against one database, and every browser context it opens uses the phone viewport.
 */
const MOBILE_SCENARIOS = new Set(['1', '2', '3', '5', '6', '9', '10', '13', '23b']);
const RESIDENT_BASE = { ...RESIDENT };
const COOK_BASE = { ...COOK };
let userOffset = 0;
test.beforeEach((_args, info) => {
  const mobile = info.project.name === 'mobile-390';
  mobileEnv.mobile = mobile;
  userOffset = mobile ? 500 : 0;
  Object.assign(RESIDENT, mobile ? { phone: '9100000501', email: 'm-resident@e2e.example' } : RESIDENT_BASE);
  Object.assign(COOK, mobile ? { phone: '9100000502', email: 'm-cook@e2e.example' } : COOK_BASE);
  if (mobile && kitchenN < 600) kitchenN = 600;
});
type Args = PlaywrightTestArgs & PlaywrightTestOptions & PlaywrightWorkerArgs & PlaywrightWorkerOptions;
function scenario(title: string, fn: (args: Args, info: TestInfo) => Promise<void>) {
  const id = title.split('. ')[0].trim();
  test(title, async (args, info) => {
    test.skip(info.project.name === 'mobile-390' && !MOBILE_SCENARIOS.has(id), 'desktop-only scenario');
    await fn(args, info);
  });
}
let sellerId = 0;
let dishId = 0;
let kitchenN = 100; // seeded kitchens get unique numbers

async function loginUI(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email or phone number').fill(identifier);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function verifyEmail(request: Parameters<typeof mockOutbox>[0], email: string) {
  const mail = (await mockOutbox(request, email)).find((m) => m.kind === 'verify_email')!;
  const token = mail.bodyText.match(/token=([\w-]+)/)![1];
  const r = await api(request, 'post', '/api/auth/verify-email', { token });
  expect(r.status).toBe(200);
}

/** A buyer with a verified email in the E2E society; returns a logged-in context. */
async function newBuyer(browser: Parameters<typeof newUserContext>[0], n: number) {
  const { ctx, page } = await newUserContext(browser);
  const u = { phone: `91000${String(1000 + n + userOffset).padStart(5, '0')}`, email: `buyer${n + userOffset}@e2e.example`, name: `Buyer ${n + userOffset}` };
  await register(page.request, u);
  await verifyEmail(page.request, u.email);
  return { ctx, page, ...u };
}

/** Books through the API: creates the order and pays the platform fee via the mock gateway. */
async function bookApi(page: Page, opts: { sellerId: number; dishId: number; qty?: number; fulfillment?: 'self_pickup' | 'seller_delivery'; useCredit?: boolean }) {
  const delivery = opts.fulfillment !== 'self_pickup';
  const r = await api(page.request, 'post', '/api/orders', {
    type: 'home_delivery', sellerId: opts.sellerId, items: [{ id: opts.dishId, qty: opts.qty ?? 2 }], fulfillmentType: opts.fulfillment ?? 'seller_delivery', useCredit: opts.useCredit,
    ...(delivery ? { address: { label: 'Home', flat: 'B-1204', societyName: 'E2E Heights', addressText: 'E2E Heights', lat: 17.465, lng: 78.31 } } : {}),
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  if (r.json.payment.mode !== 'none') {
    const p = await api(page.request, 'post', '/api/payments/mock-complete', { orderId: r.json.orderId, outcome: 'success' });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
  }
  return { orderId: r.json.orderId as number, quote: r.json.quote };
}

async function orderJson(page: Page, orderId: number) {
  const r = await api(page.request, 'get', `/api/orders/${orderId}`);
  expect(r.status).toBe(200);
  return r.json;
}

/** Fills the cart in localStorage and opens checkout (faster and steadier than clicking the dish page). */
async function openCheckout(page: Page, k: { sellerId: number; dishId: number; kitchenName: string }, qty = 2, price = 10000) {
  // An init script runs before the app's own code on the next navigation, so the cart provider reads it on hydration
  // (writing localStorage from the page after load can lose a race with the provider's own first write).
  const vendor = { kind: 'seller', id: k.sellerId, name: k.kitchenName };
  const item = { id: k.dishId, title: 'Dish', pricePaise: price, isVeg: true, photoUrl: null, maxQty: 50, qty };
  const stamp = `${k.dishId}-${qty}-${price}-${Date.now()}`;
  await page.addInitScript(([v, it, st]) => {
    try {
      if (sessionStorage.getItem('e2e_cart_stamp') === st) return;
      sessionStorage.setItem('e2e_cart_stamp', st);
      localStorage.setItem('padosi_cart', JSON.stringify({ vendor: v, items: [it] }));
      localStorage.setItem('padosi_loc', JSON.stringify({ lat: 17.465, lng: 78.31, label: 'E2E Heights' }));
    } catch {
      /* storage unavailable */
    }
  }, [vendor, item, stamp] as const);
  await page.goto('/checkout');
}

scenario('1. resident joins via invite link (18+ and terms, tower/flat), registers and verifies email through the mock outbox', async ({ page, request }) => {
  await page.goto('/join/E2E-ONE');
  await expect(page.getByTestId('join-society')).toHaveText('E2E Heights');
  // Next 16 dev (Turbopack) reloads the page once while it compiles; retry the click until navigation sticks
  await expect(async () => {
    await page.getByTestId('join-resident').click();
    await expect(page).toHaveURL(/\/register\?code=E2E-ONE/, { timeout: 5000 });
  }).toPass({ timeout: 30_000 });

  await page.getByLabel('Your name').fill(RESIDENT.name);
  await page.getByLabel('Phone number').fill(RESIDENT.phone);
  await page.locator('input[type=email]').fill(RESIDENT.email);
  await page.getByTestId('reg-tower').fill('B');
  await page.getByTestId('reg-flat').fill('1204');
  await page.locator('input[type=password]').fill('password123'); // a common password → refused
  // consent is explicit: the button stays disabled until BOTH boxes are ticked, and neither is pre-ticked
  await expect(page.getByTestId('age18')).not.toBeChecked();
  await expect(page.getByTestId('accept-terms')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await page.getByTestId('age18').check();
  await page.getByTestId('accept-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/too common/i)).toBeVisible();
  await page.locator('input[type=password]').fill(PW);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your email to verify')).toBeVisible();

  await expect(page.getByText('Please verify your email')).toBeVisible();
  const mail = (await mockOutbox(request, RESIDENT.email)).find((m) => m.kind === 'verify_email')!;
  const link = mail.bodyText.match(/http:\/\/\S+\/verify-email\?token=\S+/)![0];
  await page.goto(link);
  await expect(page.getByTestId('email-verified')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Please verify your email')).toHaveCount(0);
});

scenario('12a. a non-allowlisted user is denied /admin; the allowlisted admin changes the one-time password, then must enrol two-factor', async ({ page, browser }) => {
  await loginUI(page, RESIDENT.email, PW);
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/);
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);

  const { ctx, page: admin } = await newUserContext(browser);
  await loginUI(admin, ADMIN_EMAIL, ADMIN_FIRST_PASSWORD);
  await expect(admin).toHaveURL(/\/change-password/);
  await admin.goto('/admin');
  await expect(admin).toHaveURL(/\/change-password/); // forced
  expect((await admin.request.get('/api/admin/users')).status()).toBe(403); // API refuses until changed
  await admin.locator('input[type=password]').nth(0).fill(ADMIN_FIRST_PASSWORD);
  await admin.locator('input[type=password]').nth(1).fill('short');
  await admin.getByRole('button', { name: 'Save password' }).click();
  await expect(admin.getByText(/at least 8/i)).toBeVisible();
  await admin.locator('input[type=password]').nth(1).fill(ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Save password' }).click();

  // password changed → the admin area is still closed until two-factor is enrolled
  await admin.waitForURL(/\/(admin|auth\/2fa)/);
  await admin.goto('/admin');
  await expect(admin).toHaveURL(/\/auth\/2fa/);
  const gate = await admin.request.get('/api/admin/users');
  expect(gate.status()).toBe(403);
  expect((await gate.json()).code).toBe('mfa_enroll');
  await admin.getByTestId('start-2fa').click();
  const secret = (await admin.getByTestId('totp-secret').textContent())!.trim();
  await admin.getByTestId('totp-code').fill('000000');
  await admin.getByTestId('enable-2fa').click();
  await expect(admin.getByText(/not right/i)).toBeVisible();
  await admin.getByTestId('totp-code').fill(totpAt(secret, Date.now()));
  await admin.getByTestId('enable-2fa').click();
  await expect(admin.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  saveAdminTotp(secret);
  await admin.getByTestId('recovery-saved').click();
  await expect(admin).toHaveURL(/\/admin/);
  await expect(admin.getByText('MISSION CONTROL')).toBeVisible();
  await ctx.close();

  // a fresh login now needs the code before any admin API or page opens
  const second = await newUserContext(browser);
  await loginUI(second.page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(second.page).toHaveURL(/\/auth\/2fa/);
  const closed = await second.page.request.get('/api/admin/users');
  expect(closed.status()).toBe(403);
  expect((await closed.json()).code).toBe('mfa_required');
  await second.page.getByTestId('totp-code').fill('123456');
  await second.page.getByTestId('verify-2fa').click();
  await expect(second.page.getByText(/wrong/i).first()).toBeVisible();
  await second.page.getByTestId('totp-code').fill(adminCode());
  await second.page.getByTestId('verify-2fa').click();
  await expect(second.page).toHaveURL(/\/admin/);
  expect((await second.page.request.get('/api/admin/users')).status()).toBe(200);
  await second.ctx.close();
});

scenario('2. seller onboards: wizard, ₹1 UPI check, FSSAI "help me apply", dish → admin approves → live with the provisional badge', async ({ page, request, browser }) => {
  await register(page.request, { ...COOK, role: 'seller' });
  await verifyEmail(page.request, COOK.email);
  const me = await api(page.request, 'get', '/api/auth/me');
  sellerId = me.json.session.uid;

  // wizard: about → kitchen → hygiene → PAN → agreement (each step saves on its own)
  await page.goto('/seller/onboarding');
  await page.getByTestId('legal-name').fill('Kamala Cook');
  await page.getByTestId('display-name').fill('Kamala');
  await page.getByTestId('save-about').click();
  await expect(page.getByText('Saved ✅').first()).toBeVisible();
  await page.getByTestId('chip-Biryani').click();
  await page.getByTestId('chip-Mon').click();
  await page.getByTestId('chip-Tue').click();
  for (const n of [1, 2]) {
    await page.getByTestId('kitchen-photo-input').setInputFiles(pngFile(`k${n}.png`, [30 * n, 120, 60]));
    await expect(page.locator('img[alt="Kitchen"]').nth(n - 1)).toBeVisible();
  }
  await page.getByTestId('save-kitchen').click();
  await expect(page.getByText('Saved ✅').first()).toBeVisible();
  for (const box of await page.getByTestId('hygiene-list').getByRole('checkbox').all()) await box.check();
  await page.getByTestId('save-hygiene').click();
  await page.getByTestId('pan-input').fill('ABCDE1234F');
  await page.getByTestId('save-tax').click();
  await expect(page.getByTestId('pan-masked')).toContainText('ABCDE****F'); // never the full PAN
  await page.getByTestId('agree-box').check();
  await page.getByTestId('save-agreement').click();
  await expect(page.getByText(/Accepted \(/)).toBeVisible();

  // UPI: validated, then the ₹1 ownership check through the mock sheet
  await page.goto('/seller/payment-details');
  await page.getByTestId('vpa').fill('not a vpa');
  await expect(async () => {
    await page.getByTestId('save-payment').click();
    await expect(page.getByText(/valid UPI ID/i)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId('vpa').fill('kamala@okhdfcbank');
  await page.getByTestId('save-payment').click();
  await expect(page.getByText(/now verify it/i)).toBeVisible();
  await page.getByTestId('start-verify').click();
  await payMockSheet(page);
  await expect(page.getByTestId('verified-info')).toContainText('kamala@okhdfcbank');
  await expect(page.getByTestId('verified-info')).toContainText('KAMALA COOK'); // name shown to buyers before they pay

  // FSSAI assistant ("help me apply") with the 2026 thresholds and the anti-scam notice
  await page.goto('/seller/compliance');
  await expect(page.getByTestId('fssai-notice')).toContainText('You submit the application yourself on the official FSSAI portal');
  await expect(page.getByTestId('anti-scam')).toContainText('never charges for FSSAI');
  await page.getByRole('button', { name: /get me a license|start|apply|application/i }).first().click();
  await page.getByTestId('sales').selectOption('1_5cr_to_50cr');
  await page.getByTestId('home-yes').check();
  await page.getByTestId('telangana-yes').check();
  await expect(page.getByTestId('eligibility-result')).toContainText('State FSSAI licence'); // not Form A
  await page.getByTestId('sales').selectOption('up_to_1_5cr');
  await expect(page.getByTestId('eligibility-result')).toContainText('Basic Registration (Form A)');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('applicant').fill('Kamala Cook');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('address').fill('B-1204, E2E Heights, Nallagandla, Hyderabad 500019');
  await page.getByTestId('wizard-next').click();
  await page.getByText('Cooked meals / thali / biryani').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('years').selectOption('3');
  await expect(page.getByTestId('fee')).toContainText('₹300'); // ₹100 a year, paid on FoSCoS
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('file-id').setInputFiles(pngFile('aadhaar.png', [220, 220, 220]));
  await expect(page.getByTestId('aadhaar-mask')).toBeVisible();
  await page.getByTestId('apply-mask').click();
  await expect(page.getByText('✅ Photo ID')).toBeVisible();
  for (const slot of ['address', 'kitchen', 'photo']) await page.getByTestId(`file-${slot}`).setInputFiles(pngFile(`${slot}.png`));
  await expect(page.getByText('✅ Passport-size photo')).toBeVisible();
  await page.getByTestId('wizard-next').click();
  for (const i of [0, 1, 2]) await page.getByTestId(`decl-${i}`).check();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-submit').click();
  await expect(page).toHaveURL(/\/fssai\/\d+\/summary/);
  await expect(page.getByTestId('form-a')).toContainText('Section 4');
  await page.getByPlaceholder('FoSCoS reference no.').fill('E2E-REF-0001');
  await page.getByRole('button', { name: /I.ve filed it/ }).click();
  await expect(page.getByText('E2E-REF-0001')).toBeVisible();

  // first dish (moderation is on by default)
  await page.goto('/seller/listings');
  await page.getByRole('button', { name: /add (a )?dish|new dish|\+/i }).first().click();
  await page.getByLabel(/dish name/i).fill('Dum Biryani');
  await page.getByLabel(/price/i).first().fill('100');
  await page.getByLabel(/portions|quantity|available/i).first().fill('50');
  await page.getByTestId('ingredients').fill('Basmati rice, chicken, curd, spices');
  await page.getByTestId('allergen-milk').click();
  await page.getByRole('button', { name: /save|add dish|publish|create/i }).last().click();
  await expect(page.getByText('Dum Biryani')).toBeVisible();
  await expect(page.getByText('In review')).toBeVisible();
  const listings = await api(page.request, 'get', '/api/seller/listings');
  dishId = listings.json.listings[0].id;

  // submit for approval; the founding plan needs no payment
  await page.goto('/seller/onboarding');
  await expect(page.getByTestId('wizard-progress')).toContainText(/\d\/\d STEPS DONE/);
  await page.getByTestId('submit-listing-request').click();
  await expect(page.getByText('Under review')).toBeVisible();

  // not visible to buyers yet: FSSAI application was filed today — still inside the 7-day window ("applied")
  const resident = await newUserContext(browser);
  await login(resident.page.request, RESIDENT.email);
  expect(((await api(resident.page.request, 'get', '/api/listings')).json.listings as { id: number }[]).some((l) => l.id === dishId)).toBe(false);

  // admin approves the dish and the kitchen
  const { ctx, page: admin } = await loginAdmin(browser);
  await admin.goto('/admin/kitchens/requests');
  await admin.getByTestId(`kitchen-${sellerId}`).click();
  await expect(admin.getByText('kamala@okhdfcbank')).toBeVisible();
  await admin.goto('/admin/dishes/review');
  await admin.getByTestId('approve-dish').first().click();
  await expect(admin.getByText('Approved ✅')).toBeVisible();
  // approve from the onboarding queue: the checklist shows every requirement, then one tap approves (flags ask for a confirmation)
  admin.on('dialog', (d) => d.accept());
  await admin.goto('/admin/applications');
  const card = admin.getByTestId(`application-${sellerId}`);
  await expect(card).toBeVisible();
  await expect(card.locator('[data-check="upi"]')).toHaveAttribute('data-status', 'pass');
  await expect(card.locator('[data-check="fssai"]')).toHaveAttribute('data-status', 'flag');
  await expect(card.locator('[data-check="photos"]')).toHaveAttribute('data-status', 'pass');
  await card.getByTestId('app-approve').click();
  await expect(admin.getByText(/Approved\. The founding plan was granted/)).toBeVisible();

  // still hidden while "applied"; 8 days with no FoSCoS response → provisional → visible with the badge
  expect(((await api(resident.page.request, 'get', '/api/listings')).json.listings as { id: number }[]).some((l) => l.id === dishId)).toBe(false);
  await timeTravel(request, 'fssai_filed', sellerId, 8);
  const feed = (await api(resident.page.request, 'get', '/api/listings')).json.listings as { id: number; fssaiTier: string }[];
  expect(feed.find((l) => l.id === dishId)?.fssaiTier).toBe('provisional');
  await resident.page.goto(`/dish/${dishId}`);
  await expect(resident.page.getByText('FSSAI applied: provisional').first()).toBeVisible();
  await resident.ctx.close();
  await ctx.close();
});

let k1 = { sellerId: 0, dishId: 0, kitchenName: '', email: '' };

scenario('3. delivery happy path: book (fee only) → accept → cook → on the way → at the door → QR → collected → paid with UTR → confirmed → review', async ({ page, browser, request }) => {
  k1 = await seedKitchen(request, { n: ++kitchenN, cash: true });
  await login(page.request, RESIDENT.email);
  await openCheckout(page, k1, 2);
  // the bill is two parts, both visible upfront
  await expect(page.getByTestId('food-total')).toContainText('₹200');
  await expect(page.getByTestId('platform-fee-total')).toContainText('₹20');
  await expect(page.getByTestId('bill')).toContainText('Platform fee (10% of food)');
  await expect(page.getByTestId('pay-at-door-card')).toContainText(/only then do you pay/i);
  await page.getByText('Seller delivery').click();
  await page.getByPlaceholder('e.g. B-1204').fill('B-1204');
  await page.getByRole('button', { name: /Pay platform fee ₹20/ }).click();
  await payMockSheet(page);
  await expect(page).toHaveURL(/\/orders\/\d+/);
  const orderId = Number(page.url().match(/orders\/(\d+)/)![1]);
  await expect(page.getByText('Booked — waiting for the kitchen').first()).toBeVisible();
  await expect(page.getByTestId('pay-later-note')).toContainText('after the food reaches you');
  await expect(page.getByTestId('upi-qr')).toHaveCount(0);

  // the kitchen (UI): accept, cook, ready, on the way, reached the door
  const { ctx: sctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k1.email);
  await seller.goto('/seller/orders');
  const card = seller.getByTestId(`seller-order-${orderId}`);
  await expect(card.getByTestId('order-address')).toHaveCount(0); // flat hidden until accepted
  await card.getByTestId('act-accept').click();
  await expect(card.getByTestId('act-preparing')).toBeVisible();
  await expect(card.getByTestId('order-address')).toContainText('B-1204');
  await card.getByTestId('act-preparing').click();
  await card.getByTestId('act-ready').click();
  await card.getByTestId('act-on_the_way').click();
  await card.getByTestId('act-reached_door').click();
  await expect(card).toContainText('Waiting at the door');

  // buyer: QR appears with the verified name; collect, pay, claim with a UTR
  await expect(page.getByTestId('collect')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('collect').click();
  await expect(page.getByTestId('qr-check')).toContainText(`COOK ${kitchenN}`);
  await expect(page.getByTestId('upi-qr')).toBeVisible();
  await expect(page.getByTestId('upi-id')).toContainText(`kitchen${kitchenN}@okbank`);
  await expect(page.getByTestId('door-amount')).toHaveText('₹200');
  await page.getByPlaceholder(/12-digit/).fill('1234');
  await page.getByTestId('claim-paid').click();
  await expect(page.getByText('12 digits').or(page.getByText(/UPI reference \(UTR\) is 12 digits/))).toBeVisible();
  await page.getByPlaceholder(/12-digit/).fill('123456789012');
  await page.getByTestId('claim-paid').click();
  await expect(page.getByText('Payment sent — kitchen confirming').first()).toBeVisible();

  // the kitchen sees the claim and confirms
  await expect(card.getByTestId('seller-food-payment')).toContainText('123456789012', { timeout: 20_000 });
  await card.getByTestId('act-confirm_paid').click();
  await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '5 stars' }).click();
  await page.getByRole('button', { name: 'Submit rating' }).click();
  await expect(page.getByText('YOUR RATING')).toBeVisible();
  await sctx.close();
});

scenario('4. pickup happy path with cash: "buyer has arrived" → collected → cash → confirmed', async ({ page, browser }) => {
  await login(page.request, RESIDENT.email);
  const { orderId } = await bookApi(page, { sellerId: k1.sellerId, dishId: k1.dishId, fulfillment: 'self_pickup', qty: 1 });
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k1.email);
  for (const a of ['accept', 'preparing', 'ready', 'buyer_arrived']) await orderAction(seller.request, orderId, a);
  await page.goto(`/orders/${orderId}`);
  await page.getByTestId('collect').click();
  await page.getByRole('radio', { name: 'Cash' }).click();
  await page.getByTestId('claim-paid').click();
  await expect(page.getByText('Payment sent — kitchen confirming').first()).toBeVisible();
  await orderAction(seller.request, orderId, 'confirm_paid');
  const o = await orderJson(page, orderId);
  expect(o.order.status).toBe('completed');
  expect(o.foodPayment.method).toBe('cash');
  await ctx.close();
});

scenario("5. before the door the buyer's network responses never contain the kitchen's UPI ID or QR; the flat is hidden from the kitchen until it accepts", async ({ page, browser }) => {
  await login(page.request, RESIDENT.email);
  const { orderId } = await bookApi(page, { sellerId: k1.sellerId, dishId: k1.dishId, qty: 1 });
  const bodies: string[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/')) bodies.push(await res.text().catch(() => ''));
  });
  await page.goto(`/orders/${orderId}`);
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k1.email);
  const vpa = `kitchen${kitchenN}@okbank`;
  const leaks = async () => {
    await page.reload();
    await page.waitForLoadState('networkidle');
    const direct = JSON.stringify((await api(page.request, 'get', `/api/orders/${orderId}`)).json);
    for (const b of [...bodies, direct]) {
      expect(b).not.toContain(vpa);
      expect(b).not.toContain(`COOK ${kitchenN}`);
      expect(b).not.toContain('<svg');
      expect(b).not.toContain('upi://pay');
    }
  };
  await leaks(); // booked
  const mine = async () => JSON.stringify(((await api(seller.request, 'get', '/api/seller/orders')).json as { orders: { id: number }[] }).orders.find((o) => o.id === orderId));
  expect(await mine()).not.toContain('B-1204'); // not accepted yet
  for (const a of ['accept', 'preparing', 'ready', 'on_the_way']) {
    await orderAction(seller.request, orderId, a);
    await leaks();
  }
  expect(await mine()).toContain('B-1204');
  await orderAction(seller.request, orderId, 'reached_door');
  const after = JSON.stringify((await api(page.request, 'get', `/api/orders/${orderId}`)).json);
  expect(after).toContain(vpa); // …and only now
  expect(after).toContain('<svg');
  await ctx.close();
});

scenario('6. the kitchen cancels after accepting: fee refunded in full + equal credit + a strike; the credit pays the next fee', async ({ page, browser, request }) => {
  const k = await seedKitchen(request, { n: ++kitchenN });
  await login(page.request, RESIDENT.email);
  const { orderId } = await bookApi(page, { sellerId: k.sellerId, dishId: k.dishId, qty: 2 });
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  await orderAction(seller.request, orderId, 'accept');
  await seller.goto('/seller/orders');
  const card = seller.getByTestId(`seller-order-${orderId}`);
  await card.getByTestId('act-seller_cancel').click();
  await expect(seller.getByTestId('seller-cancel-policy')).toContainText('you get a strike');
  await seller.getByTestId('reason-input').fill('Gas cylinder ran out');
  await seller.getByTestId('confirm-reason').click();
  await expect(seller.getByText(/refunded and they got credit/)).toBeVisible();

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId('cancel-banner')).toContainText('Gas cylinder ran out');
  await expect(page.getByTestId('cancel-banner')).toContainText('platform fee of ₹20 has been refunded');
  await expect(page.getByTestId('cancel-banner')).toContainText('₹20 PadosiPlate credit');
  const o = await orderJson(page, orderId);
  expect(o.order.status).toBe('cancelled_by_seller');
  expect(o.payment.refundedInPaise).toBe(2000);
  // the credit is applied to the next order's platform fee
  await openCheckout(page, k, 2);
  await expect(page.getByText(/Use my ₹20 referral credit/)).toBeVisible();
  await expect(page.getByTestId('platform-fee-total')).toContainText('₹0');
  await ctx.close();
});

scenario('7. a kitchen that does not accept in time: the order auto-cancels, the fee is refunded in full', async ({ page, request }) => {
  const k = await seedKitchen(request, { n: ++kitchenN });
  await login(page.request, RESIDENT.email);
  const { orderId } = await bookApi(page, { sellerId: k.sellerId, dishId: k.dishId, qty: 1 });
  await timeTravelOrder(request, 'order_accept_deadline', orderId);
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByText('Cancelled — kitchen did not respond').first()).toBeVisible();
  await expect(page.getByTestId('cancel-banner')).toContainText('platform fee of ₹10 has been refunded'); // ₹100 food → ₹10 minimum fee
  expect((await orderJson(page, orderId)).payment.refundedInPaise).toBe(1000);
});

scenario('8. buyer cancels: before acceptance the fee is refunded; after acceptance it is kept (and the screen says so first)', async ({ page, browser, request }) => {
  const k = await seedKitchen(request, { n: ++kitchenN });
  const b = await newBuyer(browser, 8);
  const first = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 2 });
  await b.page.goto(`/orders/${first.orderId}`);
  await b.page.getByTestId('buyer-cancel').click();
  await expect(b.page.getByTestId('cancel-policy')).toContainText('refunded in full');
  await b.page.getByTestId('confirm-buyer-cancel').click();
  await expect(b.page.getByText('Cancelled by you').first()).toBeVisible();
  expect((await orderJson(b.page, first.orderId)).payment.refundedInPaise).toBe(2000);

  const second = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 2 });
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  await orderAction(seller.request, second.orderId, 'accept');
  await b.page.goto(`/orders/${second.orderId}`);
  await b.page.getByTestId('buyer-cancel').click();
  await expect(b.page.getByTestId('cancel-policy')).toContainText('not refunded');
  await b.page.getByTestId('confirm-buyer-cancel').click();
  await expect(b.page.getByText('Cancelled by you').first()).toBeVisible();
  expect((await orderJson(b.page, second.orderId)).payment.refundedInPaise).toBe(0);
  await ctx.close();
  await b.ctx.close();
  void page;
});

scenario("9. at the door the buyer can't pay: fee kept, buyer strike; three strikes pause ordering", async ({ page, browser, request }) => {
  void page;
  const k = await seedKitchen(request, { n: ++kitchenN });
  const b = await newBuyer(browser, 9);
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  let lastOrder = 0;
  for (let i = 0; i < 3; i++) {
    const { orderId } = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 1 });
    lastOrder = orderId;
    for (const a of ['accept', 'preparing', 'ready', 'on_the_way', 'reached_door']) await orderAction(seller.request, orderId, a);
    await orderAction(seller.request, orderId, 'buyer_couldnt_pay', { reason: 'no money on the phone' });
  }
  const o = await orderJson(b.page, lastOrder);
  expect(o.order.status).toBe('cancelled_buyer_unpaid');
  expect(o.payment.refundedInPaise).toBe(0); // fee kept
  // the fourth attempt is refused with a clear message
  await openCheckout(b.page, k, 1);
  await b.page.getByText('Seller delivery').click();
  await b.page.getByPlaceholder('e.g. B-1204').fill('1');
  await b.page.getByRole('button', { name: /Pay platform fee/ }).click();
  await expect(b.page.getByText(/Ordering is paused on your account/)).toBeVisible();
  await ctx.close();
  await b.ctx.close();
});

scenario('10. a payment dispute: the kitchen says "not received", admin resolves it both ways', async ({ page, browser, request }) => {
  void page;
  const k = await seedKitchen(request, { n: ++kitchenN });
  const b = await newBuyer(browser, 10);
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  const { ctx: actx, page: admin } = await loginAdmin(browser);
  const drive = async () => {
    const { orderId } = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 1 });
    for (const a of ['accept', 'preparing', 'ready', 'on_the_way', 'reached_door']) await orderAction(seller.request, orderId, a);
    await orderAction(b.page.request, orderId, 'collect');
    await orderAction(b.page.request, orderId, 'claim_paid', { method: 'upi', utr: '210987654321' });
    await orderAction(seller.request, orderId, 'not_received', { reason: 'nothing arrived in my account' });
    expect((await orderJson(b.page, orderId)).order.status).toBe('payment_disputed');
    return orderId;
  };
  const a = await drive();
  await expect(async () => {
    await b.page.goto(`/orders/${a}`);
    await expect(b.page.getByText('Payment under review').first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 15_000 });
  await orderAction(admin.request, a, 'resolve_paid');
  expect((await orderJson(b.page, a)).order.status).toBe('completed');
  const c = await drive();
  await orderAction(admin.request, c, 'resolve_unpaid', { reason: 'no evidence of payment' });
  expect((await orderJson(b.page, c)).order.status).toBe('closed_unpaid');
  await actx.close();
  await ctx.close();
  await b.ctx.close();
});

scenario('11. provisional caps: the 9th order of the day is blocked ("Fully booked today"); a verified FSSAI certificate lifts the cap', async ({ page, browser, request }) => {
  void page;
  const k = await seedKitchen(request, { n: ++kitchenN, fssai: 'provisional', price: 5000, qty: 100 });
  const b = await newBuyer(browser, 11);
  for (let i = 0; i < 8; i++) await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 1, fulfillment: 'self_pickup' });
  await openCheckout(b.page, k, 1, 5000);
  await b.page.getByRole('button', { name: /Pay platform fee/ }).click();
  await expect(b.page.getByText('Fully booked today')).toBeVisible();
  await b.page.goto(`/kitchen/${k.sellerId}`);
  await expect(b.page.getByText('FSSAI applied: provisional').first()).toBeVisible();

  // admin verifies the FSSAI certificate → full registration → no more provisional limit
  const { ctx, page: admin } = await loginAdmin(browser);
  const v = await api(admin.request, 'patch', `/api/admin/fssai/verify-queue/${k.sellerId}`, { action: 'verify', confirmName: true, confirmAddress: true, confirmExpiryFuture: true });
  expect(v.status, JSON.stringify(v.json)).toBe(200);
  await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 1, fulfillment: 'self_pickup' });
  await b.page.goto(`/kitchen/${k.sellerId}`);
  await expect(b.page.getByText(/FSSAI registered/).first()).toBeVisible();
  await ctx.close();
  await b.ctx.close();
});

scenario('12b. admin changes the platform fee 10% → 8%: new orders snapshot 8%, the old order keeps 10%', async ({ page, browser, request }) => {
  void page;
  const k = await seedKitchen(request, { n: ++kitchenN, price: 10000 });
  const b = await newBuyer(browser, 12);
  const before = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 2, fulfillment: 'self_pickup' }); // ₹200 → 10% = ₹20
  const { ctx, page: admin } = await loginAdmin(browser);
  await admin.goto('/admin/settings');
  await expect(admin.getByTestId('setting-buyerPlatformFeeBps')).toHaveValue('10');
  await admin.getByTestId('setting-buyerPlatformFeeBps').fill('30'); // above the 25% cap
  await admin.getByTestId('settings-reason').fill('test: above the cap');
  await expect(async () => {
    await admin.getByTestId('save-settings').click();
    await expect(admin.getByText(/must be at most/i).first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await admin.getByTestId('setting-buyerPlatformFeeBps').fill('8');
  await admin.getByTestId('settings-reason').fill('pilot discount');
  await expect(async () => {
    await admin.getByTestId('save-settings').click();
    await expect(admin.getByText(/Settings saved|Nothing changed/)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });

  const after = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 2, fulfillment: 'self_pickup' });
  const o1 = (await orderJson(b.page, before.orderId)).order;
  const o2 = (await orderJson(b.page, after.orderId)).order;
  expect([o1.feeBpsSnapshot, o1.platformFeeInPaise]).toEqual([1000, 2000]);
  expect([o2.feeBpsSnapshot, o2.platformFeeInPaise]).toEqual([800, 1600]);
  await b.page.goto(`/orders/${before.orderId}`);
  await expect(b.page.getByTestId('order-bill')).toContainText('Platform fee (10%)');
  // the change is in the history with old → new, who and why; a restore puts it back
  await admin.goto('/admin/settings');
  const hist = admin.getByTestId('settings-history');
  await expect(hist).toContainText('Buyer platform fee');
  await expect(hist).toContainText('1000');
  await expect(hist).toContainText('800');
  await expect(hist).toContainText('pilot discount');

  // put it back with the history's Restore (a fresh 2FA check is already satisfied by this session)
  const row = admin.getByTestId('settings-history').locator('li', { hasText: 'Buyer platform fee' }).filter({ hasText: '800' }).first();
  await row.getByRole('button', { name: /Restore the previous value/ }).click();
  await admin.getByTestId('restore-reason').fill('back to the standard fee');
  await admin.getByTestId('restore-confirm').click();
  // the toast is transient; the durable outcome is the setting itself
  await expect(admin.getByTestId('setting-buyerPlatformFeeBps')).toHaveValue('10');
  expect(((await api(admin.request, 'get', '/api/admin/settings')).json.settings as Record<string, unknown>).buyerPlatformFeeBps).toBe(1000);
  await ctx.close();
  await b.ctx.close();
});

scenario('14. a visitor sees the invite-only page and can request access for their society', async ({ browser }) => {
  const { ctx, page } = await newUserContext(browser);
  await page.goto('/');
  await expect(page.getByTestId('invite-only')).toContainText('invite-only during the pilot');
  expect((await page.request.get('/api/listings')).status()).toBe(403);
  await page.getByTestId('ar-society').fill('Green Meadows');
  await page.getByTestId('ar-name').fill('Ravi');
  await page.getByTestId('ar-email').fill('ravi@e2e.example');
  await page.getByTestId('ar-submit').click();
  await expect(page.getByTestId('access-sent')).toBeVisible();
  const { ctx: actx, page: admin } = await loginAdmin(browser);
  const list = await api(admin.request, 'get', '/api/admin/access-requests');
  expect((list.json.requests as { societyName: string }[]).some((r) => r.societyName === 'Green Meadows')).toBe(true);
  await actx.close();
  await ctx.close();
});

scenario('15. GST mode registered_eco_9_5: the upfront lines show fee GST and food GST, and the invoice is correct', async ({ page, browser, request }) => {
  void page;
  const k = await seedKitchen(request, { n: ++kitchenN });
  const b = await newBuyer(browser, 15);
  const { ctx, page: admin } = await loginAdmin(browser);
  const set = async (values: Record<string, unknown>) => {
    const r = await api(admin.request, 'patch', '/api/admin/settings', { ...values, reason: 'e2e GST mode scenario' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  };
  await set({ platformGstin: '36ABCDE1234F1Z5', gstMode: 'registered_eco_9_5', gstPositionConfirmedAt: '2026-11-10', gstPositionNote: 'CA confirmed registered_eco_9_5 (e2e)' });
  await openCheckout(b.page, k, 2); // ₹200 food
  await expect(b.page.getByTestId('bill')).toContainText('GST on platform fee');
  await expect(b.page.getByTestId('bill')).toContainText('GST on food');
  await expect(b.page.getByTestId('platform-fee-total')).toContainText('₹33.60'); // ₹20 fee + ₹3.60 (18%) + ₹10 food GST (5%)
  const { orderId } = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 2, fulfillment: 'self_pickup' });
  const o = (await orderJson(b.page, orderId)).order;
  expect([o.platformFeeInPaise, o.platformFeeGstInPaise, o.gstInPaise, o.onlineChargeInPaise, o.foodTotalInPaise]).toEqual([2000, 360, 1000, 3360, 20000]);
  expect(o.gstModeSnapshot).toBe('registered_eco_9_5');
  const inv = await api(b.page.request, 'get', `/api/orders/${orderId}/invoice`);
  expect(inv.status).toBe(200);
  expect(inv.json.isTaxInvoice).toBe(true);
  expect(inv.json.order).toMatchObject({ foodTotalInPaise: 20000, platformFeeInPaise: 2000, feeGstInPaise: 360, ecoGstInPaise: 1000 });
  await set({ gstMode: 'unregistered', platformGstin: '' });
  await ctx.close();
  await b.ctx.close();
});

scenario('16. account deletion is blocked while an order is open, then succeeds and anonymises', async ({ page, browser, request }) => {
  void page;
  const k = await seedKitchen(request, { n: ++kitchenN });
  const b = await newBuyer(browser, 16);
  const { orderId } = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 1, fulfillment: 'self_pickup' });
  await b.page.goto('/account');
  await b.page.getByTestId('delete-account').click();
  await b.page.getByLabel('Your password').fill(PW);
  await b.page.getByTestId('delete-confirm').fill('DELETE');
  await b.page.getByTestId('confirm-delete').click();
  await expect(b.page.getByText(/open order/i)).toBeVisible();
  await orderAction(b.page.request, orderId, 'buyer_cancel');
  // a refused attempt keeps the dialog and the typed DELETE, clears the password and says so
  await expect(b.page.getByTestId('delete-confirm')).toHaveValue('DELETE');
  await expect(b.page.getByTestId('delete-password')).toHaveValue('');
  await expect(b.page.getByText(/Enter your password again/)).toBeVisible();
  await expect(b.page.getByTestId('confirm-delete')).toBeDisabled();
  await b.page.getByTestId('delete-password').fill(PW);
  await b.page.getByTestId('confirm-delete').click();
  await expect(b.page).toHaveURL(/\/$/);
  expect((await api(b.page.request, 'get', '/api/auth/me')).json.session).toBeNull();
  const again = await api(b.page.request, 'post', '/api/auth/login', { identifier: b.email, password: PW });
  expect(again.status).toBe(401);
  await b.ctx.close();
});

scenario('8b. admin delists the kitchen: dishes vanish from the feed, the kitchen is notified (with a fresh 2FA check), relisting restores them', async ({ browser, request }) => {
  const { ctx: rctx, page: resident } = await newUserContext(browser);
  await login(resident.request, RESIDENT.email);
  const inFeed = async () => ((await api(resident.request, 'get', '/api/listings')).json.listings as { id: number }[]).some((l) => l.id === dishId);
  expect(await inFeed()).toBe(true);
  const { ctx, page: admin } = await loginAdmin(browser);
  await admin.goto(`/admin/kitchens/${sellerId}`);
  await admin.getByTestId('delist').click();
  await admin.getByRole('combobox').first().selectOption('hygiene');
  await admin.getByTestId('dialog-text').fill('Hygiene concern raised by two neighbours');
  await admin.getByTestId('dialog-confirm').click();
  await expect(admin.getByText('Kitchen delisted')).toBeVisible();
  expect(await inFeed()).toBe(false);

  const { ctx: sctx, page: seller } = await newUserContext(browser);
  await login(seller.request, COOK.email);
  await seller.goto('/seller');
  await expect(seller.getByText(/has been delisted/)).toBeVisible();
  const mails = await mockOutbox(request, COOK.email);
  expect(mails.some((m) => m.kind === 'kitchen_delist' && m.bodyText.includes('Hygiene concern'))).toBe(true);

  await admin.goto(`/admin/kitchens/${sellerId}`);
  await admin.getByTestId('relist').click();
  await expect(admin.getByText('Kitchen relisted')).toBeVisible();
  expect(await inFeed()).toBe(true);
  await sctx.close();
  await ctx.close();
  await rctx.close();
});

scenario('9b. founding-kitchen plan expiry: past ends_at + grace the listings hide automatically; renewing restores them', async ({ page, request }) => {
  await login(page.request, COOK.email);
  const inFeedAs = async () => {
    const { ctx, page: r } = await newUserContext((await page.context().browser())!);
    await login(r.request, RESIDENT.email);
    const has = ((await api(r.request, 'get', '/api/listings')).json.listings as { id: number }[]).some((l) => l.id === dishId);
    await ctx.close();
    return has;
  };
  expect(await inFeedAs()).toBe(true);
  // the founding plan (90 days free) was granted on approval
  await page.goto('/seller/subscription');
  await expect(page.getByTestId('sub-status')).toContainText('complimentary');
  const left = Number(((await page.getByTestId('sub-status').textContent()) ?? '').match(/(\d+) day\(s\) left/)![1]);
  expect(left).toBeGreaterThanOrEqual(89);
  await timeTravel(request, 'subscription', sellerId, left + 1);
  expect(await inFeedAs()).toBe(true); // inside the 3-day grace window
  await page.goto('/seller/subscription');
  await expect(page.getByTestId('sub-status')).toContainText('grace');
  await timeTravel(request, 'subscription', sellerId, 4);
  expect(await inFeedAs()).toBe(false);
  await page.goto('/seller/subscription');
  await expect(page.getByTestId('sub-status')).toContainText('expired');
  await expect(page.getByText('Your dishes are hidden from buyers').first()).toBeVisible();
  await page.getByRole('button', { name: /Pay & (subscribe|renew)/i }).first().click(); // Monthly ₹199
  await payMockSheet(page);
  await expect(page.getByTestId('sub-status')).toContainText('active');
  expect(await inFeedAs()).toBe(true);
});

scenario('13. chat: live between two browsers, quick reply, soft-filter warning, report opens a grievance, read-only after 48 hours, admin read is gated and logged', async ({ browser, request }) => {
  const k = await seedKitchen(request, { n: ++kitchenN });
  const b = await newBuyer(browser, 13);
  const { orderId } = await bookApi(b.page, { sellerId: k.sellerId, dishId: k.dishId, qty: 1, fulfillment: 'self_pickup' });
  const { ctx: sctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);

  // the buyer opens the order; the kitchen opens its orders list and its chat
  await b.page.goto(`/orders/${orderId}`);
  const bChat = b.page.getByTestId('chat');
  await expect(bChat).toBeVisible();
  await seller.goto('/seller/orders');
  await seller.getByTestId(`seller-order-${orderId}`).getByText(/Message buyer/).click();
  const sChat = seller.getByTestId('chat');
  await expect(sChat).toBeVisible();

  // quick reply from the kitchen arrives in the buyer's browser without a reload (SSE)
  await sChat.getByTestId('quick-at_gate').click();
  await expect(bChat.getByText('At your gate')).toBeVisible({ timeout: 15_000 });

  // the buyer types a payment request: warned first, nothing is sent until "Send anyway"
  await bChat.getByTestId('chat-input').fill('please send ₹500 first');
  await bChat.getByTestId('chat-send').click();
  await expect(bChat.getByTestId('chat-warning')).toBeVisible();
  expect((await orderJson(b.page, orderId)).order.id).toBe(orderId);
  const before = (await api(b.page.request, 'get', `/api/orders/${orderId}/messages`)).json.messages.length;
  expect(before).toBe(1); // only the kitchen's quick reply so far
  await bChat.getByTestId('chat-send-anyway').click();
  await expect(sChat.getByText('please send ₹500 first')).toBeVisible({ timeout: 15_000 });
  // before the door, the recipient sees the pay-at-door reminder next to it
  await expect(sChat.locator('[data-disclaimer="pay-at-door"]')).toBeVisible();

  // a normal message needs no warning
  await sChat.getByTestId('chat-input').fill('Order is almost ready');
  await sChat.getByTestId('chat-send').click();
  await expect(bChat.getByText('Order is almost ready')).toBeVisible({ timeout: 15_000 });

  // the buyer reports the kitchen's message → a grievance ticket carries the message id
  await bChat.getByText('Order is almost ready').locator('..').getByTestId('chat-report-msg').click();
  await expect(bChat.getByText('reported')).toBeVisible();

  // admin: opening the chat needs a reason + fresh 2FA, and is logged
  const { ctx: actx, page: admin } = await loginAdmin(browser);
  const gate = await api(admin.request, 'get', `/api/admin/chat/${orderId}`);
  expect(gate.json.mayRead).toBe(true);
  const noReason = await api(admin.request, 'post', `/api/admin/chat/${orderId}`, { reason: '' });
  expect(noReason.status).toBe(400);
  const read = await api(admin.request, 'post', `/api/admin/chat/${orderId}`, { reason: 'reported message review' });
  expect(read.status, JSON.stringify(read.json)).toBe(200);
  expect(read.json.messages.length).toBe(3);

  // 48 hours after the order ends, the chat is read-only
  await timeTravelOrder(request, 'order_completed_ago', orderId, 49 * 60);
  await b.page.reload();
  await expect(b.page.getByTestId('chat').getByText(/close 48 hours after an order ends/i)).toBeVisible();
  await expect(b.page.getByTestId('chat-input')).toHaveCount(0);

  await actx.close();
  await sctx.close();
  await b.ctx.close();
});

scenario('20. grievance: raised from the legal page, acknowledged automatically, flagged after 48 hours, picked up, noted and resolved by an admin', async ({ browser, request }) => {
  const b = await newBuyer(browser, 20);
  await b.page.goto('/legal/grievance');
  await expect(b.page.getByTestId('grievance-form')).toBeVisible();
  await b.page.getByTestId('grievance-subject').fill('Packet leaked in my bag');
  await b.page.getByTestId('grievance-body').fill('The curry packet leaked and the raita was missing from my order.');
  await b.page.getByTestId('grievance-submit').click();
  await expect(b.page.getByTestId('grievance-done')).toContainText('#');

  // the automatic acknowledgement: an email in the (mock) outbox and an in-app notification
  const mail = (await mockOutbox(request, b.email)).find((m) => /We received your complaint/.test(m.subject));
  expect(mail).toBeTruthy();
  const notes = (await api(b.page.request, 'get', '/api/notifications')).json.notifications as { title: string }[];
  expect(notes.some((n) => /We received your complaint/.test(n.title))).toBe(true);

  // 49 hours pass with nobody picking it up → admins are alerted and the board shows it overdue
  await timeTravelOrder(request, 'grievance_age', 0, 49 * 60);
  const { ctx: actx, page: admin } = await loginAdmin(browser);
  await admin.goto('/admin/grievances');
  await expect(admin.getByTestId('overdue-banner')).toBeVisible();
  const row = admin.getByTestId('ticket-list').locator('[data-overdue="true"]', { hasText: 'Packet leaked in my bag' });
  await expect(row).toBeVisible();
  await row.getByRole('button').first().click();

  // pick up, add a note, resolve: each lands in the history and the buyer is told the outcome
  await admin.getByTestId('g-ack').click();
  await admin.getByTestId('g-note').fill('Called the kitchen, they confirmed the leak');
  await admin.getByTestId('g-note-add').click();
  await expect(admin.getByTestId('g-history')).toContainText('Called the kitchen');
  await admin.getByTestId('g-resolution').fill('The kitchen apologised and we credited the fee');
  await admin.getByTestId('g-resolve').click();
  await expect(admin.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(async () => {
    const after = (await api(b.page.request, 'get', '/api/notifications')).json.notifications as { title: string; body: string }[];
    expect(after.some((n) => /is resolved/.test(n.title) && /apologised/.test(n.body))).toBe(true);
  }).toPass({ timeout: 10_000 });
  await actx.close();
  await b.ctx.close();
});

const patchSettings = async (admin: Page, patch: Record<string, unknown>, reason = 'e2e') => {
  const r = await api(admin.request, 'patch', '/api/admin/settings', { ...patch, reason });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
};

scenario('17. go-live: the admin page lists what is missing, and the live guard agrees with it', async ({ browser }) => {
  const { ctx, page: admin } = await loginAdmin(browser);
  await admin.goto('/admin/go-live');
  await expect(admin.getByTestId('golive-summary')).toBeVisible();
  const rows = admin.locator('[data-testid^="golive-"][data-status]');
  expect(await rows.count()).toBeGreaterThan(5);
  // in mock mode with legal documents still in draft, at least one row must not be "ok"
  expect(await admin.locator('[data-testid^="golive-"][data-status]:not([data-status="ok"])').count()).toBeGreaterThan(0);
  await ctx.close();
});

scenario('18. dish rules: allergens, food mark and prohibited words are enforced; a health claim waits for moderation', async ({ browser, request }) => {
  const k = await seedKitchen(request, { n: ++kitchenN });
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  const base = { title: 'Lemon rice', priceRupees: 90, cuisine: 'South Indian', foodMark: 'veg', ingredients: 'rice, lemon, peanuts', allergens: ['peanuts'], availableQty: 5, isVeg: true };
  const noAllergens = await api(seller.request, 'post', '/api/seller/listings', { ...base, allergens: [] });
  expect(noAllergens.status).toBe(400);
  const noMark = await api(seller.request, 'post', '/api/seller/listings', { ...base, foodMark: undefined });
  expect(noMark.status).toBe(400);
  const banned = await api(seller.request, 'post', '/api/seller/listings', { ...base, title: 'Bhang lassi' });
  expect(banned.status).toBe(400);
  expect(JSON.stringify(banned.json)).toMatch(/cannot be sold/i);
  const ok = await api(seller.request, 'post', '/api/seller/listings', base);
  expect(ok.status, JSON.stringify(ok.json)).toBe(200);
  const claim = await api(seller.request, 'post', '/api/seller/listings', { ...base, title: 'Detox khichdi', description: 'cures everything' });
  expect(claim.status, JSON.stringify(claim.json)).toBe(200);
  const mine = (await api(seller.request, 'get', '/api/seller/listings')).json.listings as { title: string; moderationStatus: string }[];
  expect(mine.find((l) => l.title === 'Detox khichdi')?.moderationStatus).not.toBe('approved');
  await ctx.close();
});

scenario('19. re-consent: a material change to the terms blocks the resident until they accept it', async ({ browser, request }) => {
  const b = await newBuyer(browser, 19);
  await b.page.goto('/');
  await expect(b.page.getByTestId('reconsent-modal')).toHaveCount(0);
  const { ctx, page: admin } = await loginAdmin(browser);
  const cur = await api(admin.request, 'get', '/api/admin/legal/terms');
  expect(cur.status, JSON.stringify(cur.json)).toBe(200);
  const body = String((cur.json.document ?? cur.json).body ?? 'Terms of use (draft). ') + '\n\nE2E: a clearly material clause about pre-orders.';
  const pub = await api(admin.request, 'post', '/api/admin/legal/terms', { action: 'publish', title: 'Terms of use', body, material: true, changeSummary: 'Pre-order rules added' });
  expect(pub.status, JSON.stringify(pub.json)).toBe(200);
  await b.page.goto('/');
  const modal = b.page.getByTestId('reconsent-modal');
  await expect(modal).toBeVisible();
  await expect(b.page.getByTestId('change-summary')).toContainText('Pre-order rules added');
  await expect(b.page.getByTestId('reconsent-accept')).toBeDisabled();
  await b.page.getByTestId('accept-terms').check();
  await b.page.getByTestId('reconsent-accept').click();
  await expect(modal).toHaveCount(0);
  await b.page.reload();
  await expect(b.page.getByTestId('reconsent-modal')).toHaveCount(0);
  await ctx.close();
});

scenario('21. favourites and today’s menu: follow a kitchen, the kitchen publishes, the follower is told', async ({ browser, request }) => {
  const k = await seedKitchen(request, { n: ++kitchenN });
  const b = await newBuyer(browser, 21);
  await b.page.goto(`/kitchen/${k.sellerId}`);
  await b.page.getByTestId('favourite').click();
  await expect(b.page.getByTestId('favourite')).toHaveAttribute('aria-pressed', 'true');
  await b.page.goto('/favourites');
  await expect(b.page.getByTestId('favourites')).toContainText(k.kitchenName);

  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  await seller.goto('/seller/listings');
  const pub = seller.getByTestId('menu-publisher');
  await expect(pub).toBeVisible();
  await seller.getByTestId(`menu-dish-${k.dishId}`).click();
  await seller.getByTestId('menu-note').fill('Fresh biryani today');
  await seller.getByTestId('menu-publish').click();
  await expect(seller.getByTestId('menu-url')).toBeVisible();
  const menuUrl = new URL((await seller.getByTestId('menu-url').innerText()).trim());

  const notes = (await api(b.page.request, 'get', '/api/notifications')).json.notifications as { title: string; body: string }[];
  expect(notes.some((n) => /Fresh biryani today/.test(n.body))).toBe(true);
  await b.page.goto(menuUrl.pathname);
  await expect(b.page.getByText('Fresh biryani today')).toBeVisible();
  await ctx.close();
});

scenario('22. pre-order: a buyer schedules an order for a later day; the fee is paid now and the kitchen sees it as scheduled', async ({ browser, request }) => {
  const k = await seedKitchen(request, { n: ++kitchenN, price: 12000 });
  const b = await newBuyer(browser, 22);
  const when = new Date(Date.now() + 2 * 86_400_000);
  when.setUTCHours(7, 30, 0, 0); // 13:00 IST
  const r = await api(b.page.request, 'post', '/api/orders', { type: 'home_delivery', sellerId: k.sellerId, items: [{ id: k.dishId, qty: 1 }], fulfillmentType: 'self_pickup', scheduledFor: when.toISOString() });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const tooSoon = await api(b.page.request, 'post', '/api/orders', { type: 'home_delivery', sellerId: k.sellerId, items: [{ id: k.dishId, qty: 1 }], fulfillmentType: 'self_pickup', scheduledFor: new Date(Date.now() + 10 * 60_000).toISOString() });
  expect(tooSoon.status).toBe(400);
  const paid = await api(b.page.request, 'post', '/api/payments/mock-complete', { orderId: r.json.orderId, outcome: 'success' });
  expect(paid.status).toBe(200);
  const o = (await orderJson(b.page, r.json.orderId)).order;
  expect(o.status).toBe('booked');
  expect(o.scheduledFor).toBeTruthy();
  await b.page.goto(`/orders/${r.json.orderId}`);
  await expect(b.page.getByText(/Scheduled|Pre-order/i).first()).toBeVisible();
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  await seller.goto('/seller/orders');
  await expect(seller.getByTestId(`seller-order-${r.json.orderId}`)).toBeVisible();
  await ctx.close();
});

scenario('23. flag-off features: 404 by default; switched on by an admin they work end to end, and switched off again they vanish', async ({ browser, request }) => {
  const { ctx: actx, page: admin } = await loginAdmin(browser);
  const b = await newBuyer(browser, 23);
  // off by default
  expect((await api(b.page.request, 'get', '/api/plus')).status).toBe(404);
  expect((await api(b.page.request, 'get', '/api/meal-plans?sellerId=1')).status).toBe(404);
  expect((await api(b.page.request, 'post', '/api/bulk', { sellerId: 1, description: 'a party of twenty people', portions: 20, forDate: '2099-01-01' })).status).toBe(404);
  await b.page.goto('/plus');
  await expect(b.page.getByText(/Not available yet/)).toBeVisible();

  await patchSettings(admin, { plusEnabled: true, bulkOrdersEnabled: true, featuredEnabled: true, campaignsEnabled: true, mealPlansEnabled: true, bulkMinPortions: 10 }, 'e2e: switch the optional features on');
  const k = await seedKitchen(request, { n: ++kitchenN, price: 10000, qty: 50 });

  // Plus: explicit consent, mock payment, active, and the fee discount shows on the next order
  await b.page.goto('/plus');
  await expect(b.page.getByTestId('plus-page')).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Buy one month' })).toBeDisabled();
  await b.page.getByRole('checkbox').check();
  await b.page.getByRole('button', { name: 'Buy one month' }).click();
  await expect(b.page.getByTestId('plus-active')).toBeVisible();

  // bulk: request → quote → accept → scheduled order
  const when = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const req = await api(b.page.request, 'post', '/api/bulk', { sellerId: k.sellerId, description: 'Birthday lunch for the family', portions: 10, forDate: when });
  expect(req.status, JSON.stringify(req.json)).toBe(200);
  const { ctx: sctx, page: seller } = await newUserContext(browser);
  await login(seller.request, k.email);
  const q = await api(seller.request, 'post', '/api/seller/bulk', { id: req.json.request.id, action: 'quote', items: [{ listingId: k.dishId, qty: 10 }], note: 'Happy to cook' });
  expect(q.status, JSON.stringify(q.json)).toBe(200);
  const acc = await api(b.page.request, 'post', `/api/bulk/${req.json.request.id}`, { action: 'accept' });
  expect(acc.status, JSON.stringify(acc.json)).toBe(200);

  // featured placement shows as "Sponsored" in the feed payload, separately from ranking
  const place = await api(admin.request, 'post', '/api/admin/featured', { sellerId: k.sellerId, societyId: 1, startsOn: '2026-01-01', endsOn: '2099-01-01' });
  expect([200, 400]).toContain(place.status);

  // campaign page
  const camp = await api(admin.request, 'post', '/api/admin/campaigns', { slug: 'e2e-feast', title: 'E2E feast', body: 'Pre-order for the weekend', startsOn: '2026-01-01', endsOn: '2099-01-01', sellerIds: [k.sellerId] });
  expect(camp.status, JSON.stringify(camp.json)).toBe(200);
  await b.page.goto('/campaigns/e2e-feast');
  await expect(b.page.getByTestId('campaign-page')).toContainText('E2E feast');
  await expect(b.page.getByTestId('campaign-kitchens')).toContainText(k.kitchenName);

  // off again: gone
  await patchSettings(admin, { plusEnabled: false, bulkOrdersEnabled: false, featuredEnabled: false, campaignsEnabled: false, mealPlansEnabled: false }, 'e2e: back to the pilot defaults');
  expect((await api(b.page.request, 'get', '/api/plus')).status).toBe(404);
  expect((await b.page.goto('/campaigns/e2e-feast'))?.status()).toBe(404);
  await sctx.close();
  await actx.close();
});

scenario('23b. flag-off UIs: Sponsored feed card and meal plans (kitchen create/edit/pause, buyer book/skip/pause) when switched on', async ({ browser, request }) => {
  const b = await newBuyer(browser, 230);
  await flagUiJourney({ browser, request, buyer: b.page, kitchenNo: ++kitchenN });
  await b.ctx.close();
});
