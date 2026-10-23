import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_FIRST_PASSWORD, ADMIN_PASSWORD, api, login, mockOutbox, newUserContext, payMockSheet, pngFile, register, timeTravel } from './helpers';

/**
 * Serial journey through the whole pilot, against MOCK_MODE + PGlite.
 * State carries between tests on purpose (one resident, one kitchen, one admin).
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const RESIDENT = { phone: '9100000001', email: 'resident@e2e.example', name: 'Rhea Resident' };
const COOK = { phone: '9100000002', email: 'cook@e2e.example', name: 'Kamala Cook', kitchenName: 'Kamala’s Kitchen' };
let sellerId = 0;
let dishId = 0;
let bigOrderId = 0;

async function loginUI(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email or phone number').fill(identifier);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('1. resident joins via invite link, registers and verifies email through the mock outbox', async ({ page, request }) => {
  await page.goto('/join/E2E-ONE');
  await expect(page.getByTestId('join-society')).toHaveText('E2E Heights');
  await page.getByTestId('join-resident').click();
  await expect(page).toHaveURL(/\/register\?code=E2E-ONE/);

  await page.getByLabel('Your name').fill(RESIDENT.name);
  await page.getByLabel('Phone number').fill(RESIDENT.phone);
  await page.locator('input[type=email]').fill(RESIDENT.email);
  await page.locator('input[type=password]').fill('password123'); // a common password → refused
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/too common/i)).toBeVisible();
  await page.locator('input[type=password]').fill('Sturdy-pass-42');
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

test('10. a non-allowlisted user is denied /admin; the allowlisted admin must change the one-time password first', async ({ page, browser }) => {
  // resident (not allowlisted) → bounced
  await loginUI(page, RESIDENT.email, 'Sturdy-pass-42');
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/);
  const denied = await page.request.get('/api/admin/users');
  expect(denied.status()).toBe(403);

  // allowlisted admin created by bootstrap logs in with the one-time password
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
  await expect(admin).toHaveURL(/\/admin/);
  await expect(admin.getByText('MISSION CONTROL')).toBeVisible();
  await ctx.close();
});

test('2. seller onboards: profile photos, UPI, FSSAI assistant (masked Aadhaar), dish, subscription, listing request', async ({ page, request, browser }) => {
  void browser;
  await register(page.request, { ...COOK, role: 'seller' });
  const me = await api(page.request, 'get', '/api/auth/me');
  sellerId = me.json.session.uid;

  // kitchen profile: 3 photos
  await page.goto('/seller/onboarding');
  const photoInput = page.locator('input[type=file][accept^="image"]').first();
  for (const n of [1, 2, 3]) {
    await photoInput.setInputFiles(pngFile(`k${n}.png`, [30 * n, 120, 60]));
    await expect(page.locator('img').nth(n - 1)).toBeVisible();
  }
  await page.getByRole('button', { name: /save/i }).first().click();

  // payment details: UPI VPA validated
  await page.goto('/seller/payment-details');
  await page.getByTestId('vpa').fill('not a vpa');
  await page.getByTestId('vpa-name').fill('Kamala Cook');
  await expect(async () => {
    await page.getByTestId('save-payment').click();
    await expect(page.getByText(/valid UPI ID/i)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId('vpa').fill('kamala@okhdfcbank');
  await page.getByTestId('save-payment').click();
  await expect(page.getByText('Payment details saved')).toBeVisible();

  // FSSAI assistant
  await page.goto('/seller/compliance');
  await expect(page.getByTestId('fssai-notice')).toContainText('You submit the application yourself on the official FSSAI portal');
  await page.getByRole('button', { name: /get me a license|start|apply|application/i }).first().click();
  await page.getByTestId('sales').selectOption('12l_to_20cr');
  await page.getByTestId('home-yes').check();
  await page.getByTestId('telangana-yes').check();
  await expect(page.getByTestId('eligibility-result')).toContainText('State FSSAI licence'); // not Form A
  await page.getByTestId('sales').selectOption('under_12l');
  await expect(page.getByTestId('eligibility-result')).toContainText('Basic Registration (Form A)');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('applicant').fill('Kamala Cook');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('address').fill('B-1204, Aparna Cyberzon, Nallagandla, Hyderabad 500019');
  await page.getByTestId('wizard-next').click();
  await page.getByText('Cooked meals / thali / biryani').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('years').selectOption('3');
  await expect(page.getByTestId('fee')).toContainText('₹300');
  await page.getByTestId('wizard-next').click();
  // documents — the Aadhaar must be masked in the browser before upload
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
  await expect(page.getByTestId('walkthrough').locator('li').first()).toBeVisible();
  // the seller files on FoSCoS themselves and enters the reference number
  await page.getByPlaceholder('FoSCoS reference no.').fill('E2E-REF-0001');
  await page.getByRole('button', { name: /I.ve filed it/ }).click();
  await expect(page.getByText('E2E-REF-0001')).toBeVisible();
  await timeTravel(request, 'fssai_filed', sellerId, 8); // 8 days with no FoSCoS response → deemed eligible

  // first dish
  await page.goto('/seller/listings');
  await page.getByRole('button', { name: /add (a )?dish|new dish|\+/i }).first().click();
  await page.getByLabel(/dish name/i).fill('Dum Biryani');
  await page.getByLabel(/price/i).first().fill('100');
  await page.getByLabel(/portions|quantity|available/i).first().fill('20');
  await page.getByRole('button', { name: /save|add dish|publish|create/i }).last().click();
  await expect(page.getByText('Dum Biryani')).toBeVisible();
  await expect(page.getByText('In review')).toBeVisible(); // dish moderation is on by default
  const listings = await api(page.request, 'get', '/api/seller/listings');
  dishId = listings.json.listings[0].id;

  // subscription: Launch – 3 months via mock Razorpay
  await page.goto('/seller/subscription');
  await expect(page.getByText('Launch – 3 months')).toBeVisible();
  await page.getByRole('button', { name: /Pay & subscribe/ }).click();
  await payMockSheet(page);
  await expect(page.getByText('Subscription active')).toBeVisible();
  await expect(page.getByTestId('sub-status')).toContainText('active');
  await expect(page.getByRole('link', { name: 'Invoice' })).toBeVisible();

  // listing request
  await page.goto('/seller');
  await expect(page.getByTestId('seller-checklist')).toBeVisible();
  await page.getByTestId('submit-listing-request').click();
  await expect(page.getByText('Submitted — the PadosiPlate team is reviewing')).toBeVisible();
});

test('3. admin reviews the request, messages the kitchen (who replies), approves the dish and the kitchen → live', async ({ browser, request }) => {
  const { ctx, page: admin } = await newUserContext(browser);
  await loginUI(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(admin).toHaveURL(/\/admin/);

  await admin.goto('/admin/kitchens/requests');
  await admin.getByTestId(`kitchen-${sellerId}`).click();
  await expect(admin.getByTestId('kitchen-photos').locator('img')).toHaveCount(3);
  await expect(admin.getByText('kamala@okhdfcbank')).toBeVisible();
  await expect(admin.getByTestId('kitchen-subscriptions')).toContainText('active');

  // "Photos need improvement" template
  await admin.getByTestId('message-kitchen').click();
  await admin.getByRole('combobox').first().selectOption({ label: 'Photos need improvement' });
  await expect(admin.getByTestId('msg-subject')).toHaveValue('Photos need improvement');
  await admin.getByTestId('dialog-confirm').click();
  await expect(admin.getByText('Message sent')).toBeVisible();
  expect((await mockOutbox(request, COOK.email)).some((m) => m.kind === 'admin_message')).toBe(true);

  // seller sees it with an unread badge and replies
  const { ctx: sctx, page: seller } = await newUserContext(browser);
  await login(seller.request, COOK.email);
  await seller.goto('/seller');
  await expect(seller.getByLabel('1 unread')).toBeVisible();
  await seller.goto('/seller/inbox');
  await seller.getByText('Photos need improvement').first().click();
  await seller.getByTestId('reply-box').fill('Uploaded brighter photos — thanks!');
  await seller.getByTestId('send-reply').click();
  await expect(seller.getByText('Uploaded brighter photos')).toBeVisible();

  // admin sees the reply, approves dish then kitchen
  await admin.goto('/admin/inbox');
  await expect(admin.getByText('1 new')).toBeVisible();
  await admin.goto('/admin/dishes/review');
  await admin.getByTestId('approve-dish').first().click();
  await expect(admin.getByText('Approved ✅')).toBeVisible();
  await admin.goto(`/admin/kitchens/${sellerId}`);
  await admin.getByTestId('approve').click();
  await expect(admin.getByText('Live to buyers')).toBeVisible();
  await expect(admin.getByText('Kitchen approved ✅')).toBeVisible();

  // the resident now sees the dish in the feed
  const feed = await api(request, 'get', '/api/listings');
  expect((feed.json.listings as { id: number }[]).some((l) => l.id === dishId)).toBe(true);
  await sctx.close();
  await ctx.close();
});

async function orderViaUI(page: Page, mode: 'upi' | 'pickup') {
  await page.goto(`/dish/${dishId}`);
  await page.getByRole('button', { name: 'Add to basket' }).click();
  await page.getByRole('button', { name: 'Add one' }).click();
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem('padosi_cart') || '{}').items?.[0]?.qty === 2; } catch { return false; }
  });
  await page.goto('/checkout');
  await expect(page.getByTestId('food-total')).toContainText('₹200');
  return page;
}

test('4. buyer orders with UPI now: food ₹200 to the kitchen + ₹20 platform fee; kitchen confirms, accepts, OTP completes', async ({ page, browser }) => {
  await login(page.request, RESIDENT.email);
  await orderViaUI(page, 'upi');
  await expect(page.getByTestId('food-total')).toContainText('Food, paid to Kamala');
  await expect(page.getByTestId('platform-fee-total')).toContainText('₹20');
  await expect(page.getByTestId('bill')).toContainText('Platform fee (10% of food)');
  await page.getByRole('button', { name: /Pay platform fee ₹20/ }).click();
  await payMockSheet(page);
  await expect(page).toHaveURL(/\/orders\/\d+/);
  bigOrderId = Number(page.url().match(/orders\/(\d+)/)![1]);

  // UPI step: QR on desktop, "I've paid"
  await expect(page.getByTestId('upi-step')).toContainText('₹200');
  await expect(page.getByTestId('upi-qr')).toBeVisible();
  await expect(page.getByTestId('upi-step')).toContainText('kamala@okhdfcbank');
  await page.getByTestId('claim-paid').click();
  await expect(page.getByText('Waiting for kitchen')).toBeVisible();

  // kitchen: payment received → accept → cook → ready → OTP
  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, COOK.email);
  await seller.goto('/seller/orders');
  const card = seller.getByTestId(`seller-order-${bigOrderId}`);
  await expect(card).toContainText('Buyer #');
  await expect(card).not.toContainText(RESIDENT.name);
  await expect(card).not.toContainText(RESIDENT.phone);
  await card.getByTestId('payment-received').click();
  await expect(card).toContainText('UPI payment confirmed');
  await card.getByRole('button', { name: 'Accept' }).click();
  await card.getByRole('button', { name: 'Start cooking' }).click();
  await card.getByRole('button', { name: 'Mark ready' }).click();
  const detail = await api(page.request, 'get', `/api/orders/${bigOrderId}`);
  const otp = detail.json.order.otpCode as string;
  expect(otp).toMatch(/^\d{4}$/);
  // the buyer cannot complete their own order
  const own = await api(page.request, 'post', `/api/orders/${bigOrderId}/verify-otp`, { otp });
  expect(own.status).toBe(403);
  await card.getByPlaceholder("Buyer's OTP").fill(otp);
  await card.getByRole('button', { name: 'Collected' }).click();
  await page.goto(`/orders/${bigOrderId}`);
  await expect(page.getByText('Picked up').first()).toBeVisible();
  await ctx.close();
});

test('5. same flow with pay-at-pickup', async ({ page, browser }) => {
  await login(page.request, RESIDENT.email);
  await orderViaUI(page, 'pickup');
  await page.getByText('Pay at pickup').first().click();
  await page.getByRole('button', { name: /Pay platform fee ₹20/ }).click();
  await payMockSheet(page);
  await expect(page).toHaveURL(/\/orders\/\d+/);
  const id = Number(page.url().match(/orders\/(\d+)/)![1]);
  await expect(page.getByTestId('pay-at-pickup-note')).toContainText('₹200');
  await expect(page.getByTestId('upi-step')).toHaveCount(0);

  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, COOK.email);
  await seller.goto('/seller/orders');
  const card = seller.getByTestId(`seller-order-${id}`);
  await card.getByRole('button', { name: 'Accept' }).click();
  await card.getByRole('button', { name: 'Start cooking' }).click();
  await card.getByRole('button', { name: 'Mark ready' }).click();
  await expect(card.getByText('Record payment at handover first')).toBeVisible(); // OTP blocked
  await card.getByTestId('paid-at-handover').click();
  const otp = (await api(page.request, 'get', `/api/orders/${id}`)).json.order.otpCode as string;
  await card.getByPlaceholder("Buyer's OTP").fill(otp);
  await card.getByRole('button', { name: 'Collected' }).click();
  await page.goto(`/orders/${id}`);
  await expect(page.getByText('Picked up').first()).toBeVisible();
  await ctx.close();
});

test('6. kitchen rejects: platform fee refunded via mock Razorpay and stock released', async ({ page, browser }) => {
  await login(page.request, RESIDENT.email);
  const before = (await api(page.request, 'get', `/api/seller/listings`)).status; // buyer → 403, just a probe
  expect(before).toBe(403);
  const stock = async () => ((await api(page.request, 'get', '/api/listings')).json.listings as { id: number; availableQty: number }[]).find((l) => l.id === dishId)!.availableQty;
  const start = await stock();
  await orderViaUI(page, 'upi');
  await page.getByRole('button', { name: /Pay platform fee ₹20/ }).click();
  await payMockSheet(page);
  await expect(page).toHaveURL(/\/orders\/\d+/);
  const id = Number(page.url().match(/orders\/(\d+)/)![1]);
  expect(await stock()).toBe(start - 2);

  const { ctx, page: seller } = await newUserContext(browser);
  await login(seller.request, COOK.email);
  await seller.goto('/seller/orders');
  await seller.getByTestId(`seller-order-${id}`).getByRole('button', { name: /Reject/ }).click();
  await expect(seller.getByText(/platform fee was refunded/)).toBeVisible();
  expect(await stock()).toBe(start);
  const o = (await api(page.request, 'get', `/api/orders/${id}`)).json;
  expect(o.order.status).toBe('cancelled');
  expect(o.order.refundInPaise).toBe(2000);
  expect(o.payment.status).toBe('refunded');
  await page.goto(`/orders/${id}`);
  await expect(page.getByText(/refunded/i).first()).toBeVisible();
  await ctx.close();
});

test('7. admin changes the platform fee to 12%: the next order snapshots 12%, older orders keep 10%', async ({ browser, page }) => {
  const { ctx, page: admin } = await newUserContext(browser);
  await loginUI(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.goto('/admin/settings');
  await expect(admin.getByTestId('setting-buyerPlatformFeeBps')).toHaveValue('10');
  await admin.getByTestId('setting-buyerPlatformFeeBps').fill('30'); // above the 25% cap
  await expect(async () => {
    await admin.getByTestId('save-settings').click();
    await expect(admin.getByText(/at most/i)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await admin.getByTestId('setting-buyerPlatformFeeBps').fill('12');
  await expect(async () => {
    await admin.getByTestId('save-settings').click();
    await expect(admin.getByText(/Settings saved|Nothing changed/)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });

  await login(page.request, RESIDENT.email);
  await orderViaUI(page, 'upi');
  await expect(page.getByTestId('platform-fee-total')).toContainText('₹24');
  await expect(page.getByTestId('bill')).toContainText('(12% of food)');
  await page.getByRole('button', { name: /Pay platform fee ₹24/ }).click();
  await payMockSheet(page);
  await expect(page).toHaveURL(/\/orders\/\d+/);
  const newId = Number(page.url().match(/orders\/(\d+)/)![1]);
  const newer = (await api(page.request, 'get', `/api/orders/${newId}`)).json.order;
  const older = (await api(page.request, 'get', `/api/orders/${bigOrderId}`)).json.order;
  expect([newer.feeBpsSnapshot, newer.platformFeeInPaise]).toEqual([1200, 2400]);
  expect([older.feeBpsSnapshot, older.platformFeeInPaise]).toEqual([1000, 2000]);
  await page.goto(`/orders/${bigOrderId}`);
  await expect(page.getByTestId('order-bill')).toContainText('Platform fee (10%)');

  // put it back
  await admin.goto('/admin/settings');
  await expect(admin.getByTestId('setting-buyerPlatformFeeBps')).toHaveValue('12');
  await admin.getByTestId('setting-buyerPlatformFeeBps').fill('10');
  await expect(async () => {
    await admin.getByTestId('save-settings').click();
    await expect(admin.getByText(/Settings saved|Nothing changed/)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await ctx.close();
});

test('8. admin delists the kitchen: dishes vanish from the feed, the kitchen is notified, relisting restores them', async ({ browser, request }) => {
  const { ctx, page: admin } = await newUserContext(browser);
  await loginUI(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  const inFeed = async () => ((await api(request, 'get', '/api/listings')).json.listings as { id: number }[]).some((l) => l.id === dishId);
  expect(await inFeed()).toBe(true);

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
  const notes = await api(seller.request, 'get', '/api/notifications');
  expect(JSON.stringify(notes.json)).toContain('delisted');

  await admin.goto(`/admin/kitchens/${sellerId}`);
  await admin.getByTestId('relist').click();
  await expect(admin.getByText('Kitchen relisted')).toBeVisible();
  expect(await inFeed()).toBe(true);
  await sctx.close();
  await ctx.close();
});

test('9. subscription expiry: past ends_at + grace the listings are hidden; renewing restores them', async ({ page, request }) => {
  const inFeed = async () => ((await api(request, 'get', '/api/listings')).json.listings as { id: number }[]).some((l) => l.id === dishId);
  await login(page.request, COOK.email);
  expect(await inFeed()).toBe(true);
  // 3-month plan (calendar months, so 90–92 days): read the days left, then jump 1 day past the end → inside the 3-day grace window
  await page.goto('/seller/subscription');
  const left = Number(((await page.getByTestId('sub-status').textContent()) ?? '').match(/(\d+) day\(s\) left/)![1]);
  await timeTravel(request, 'subscription', sellerId, left + 1);
  expect(await inFeed()).toBe(true);
  await page.goto('/seller/subscription');
  await expect(page.getByTestId('sub-status')).toContainText('grace');
  await expect(page.getByText(/grace period/i).first()).toBeVisible();
  // past grace → hidden automatically
  await timeTravel(request, 'subscription', sellerId, 4);
  expect(await inFeed()).toBe(false);
  await page.goto('/seller/subscription');
  await expect(page.getByTestId('sub-status')).toContainText('expired');
  await expect(page.getByText('Your dishes are hidden from buyers').first()).toBeVisible();
  // renew → back
  await page.getByRole('button', { name: /Pay & (subscribe|renew)/i }).first().click();
  await payMockSheet(page);
  await expect(page.getByTestId('sub-status')).toContainText('active');
  expect(await inFeed()).toBe(true);
});
