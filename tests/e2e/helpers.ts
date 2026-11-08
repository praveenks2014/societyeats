import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { totpAt } from '../../src/lib/auth/totp';
import { BRAND } from '@/config/brand';

export const ADMIN_EMAIL = 'e2e-admin@example.com';
export const ADMIN_FIRST_PASSWORD = 'E2e-first-pass-1';
export const ADMIN_PASSWORD = 'E2e-final-pass-77';

/** A valid, tiny PNG (solid colour) — enough for upload validation and sharp. */
export function png(color: [number, number, number] = [200, 120, 60], size = 64): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) color.forEach((c, i) => (raw[y * (size * 3 + 1) + 1 + x * 3 + i] = c));
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const pngFile = (name = 'photo.png', color?: [number, number, number]) => ({ name, mimeType: 'image/png', buffer: png(color) });

/** Every CSP violation, page error and console error seen by any guarded context; the fixture in fixtures.ts fails the test if this is not empty. */
export const guardLog: string[] = [];

/** Watches every page of a context: CSP violations (a document-level event), uncaught page errors and console errors (failed network responses are asserted by the tests themselves). */
export function guardContext(ctx: BrowserContext): void {
  void ctx.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`));
  });
  ctx.on('page', (page) => {
    page.on('pageerror', (e) => guardLog.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (t.startsWith('Failed to load resource')) return;
      guardLog.push(`console.error: ${t.slice(0, 300)} @ ${page.url()}`);
    });
  });
}

/** Set by the specs: when true every context opened with `newUserContext` uses the 390px phone profile (the `browser` fixture does not inherit the project's device settings). */
export const mobileEnv = { mobile: false };
export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

export async function newUserContext(browser: Browser, opts: { viewport?: { width: number; height: number } } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3100', ...(mobileEnv.mobile ? PHONE : {}), ...opts });
  guardContext(ctx);
  return { ctx, page: await ctx.newPage() };
}

export async function api(request: APIRequestContext, method: 'get' | 'post' | 'patch' | 'put', url: string, data?: unknown) {
  // the dev server occasionally resets a connection while compiling a route; only idempotent GETs are retried
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await request[method](url, data === undefined ? undefined : { data });
      break;
    } catch (e) {
      if (method !== 'get' || attempt >= 2) throw e;
    }
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* none */
  }
  return { status: res.status(), json };
}

export async function register(request: APIRequestContext, u: { phone: string; email: string; name: string; role?: 'buyer' | 'seller'; code?: string; kitchenName?: string }) {
  const r = await api(request, 'post', '/api/auth/register', { password: 'Sturdy-pass-42', inviteCode: u.code ?? 'E2E-ONE', role: u.role ?? 'buyer', age18: true, acceptTerms: true, tower: 'B', flat: '1204', ...u });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

export async function login(request: APIRequestContext, identifier: string, password = 'Sturdy-pass-42') {
  const r = await api(request, 'post', '/api/auth/login', { identifier, password });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json;
}

export async function mockOutbox(request: APIRequestContext, to: string) {
  const r = await api(request, 'get', `/api/dev/outbox?to=${encodeURIComponent(to)}`);
  return r.json.emails as { kind: string; subject: string; bodyText: string }[];
}

export async function timeTravel(request: APIRequestContext, kind: 'subscription' | 'fssai_filed', sellerId: number, days: number) {
  const r = await api(request, 'post', '/api/dev/time-travel', { kind, sellerId, days });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

/** Pay through the styled mock Razorpay sheet (the "Pay ₹X (test)" button). */
export async function payMockSheet(page: Page) {
  await page.getByRole('button', { name: /^Pay .* \(test\)$/ }).click();
}

// ---------- admin two-factor ----------
const SECRET_FILE = path.join(os.tmpdir(), `${BRAND.slug}-e2e-admin-totp.json`);
export function saveAdminTotp(secret: string) {
  fs.writeFileSync(SECRET_FILE, JSON.stringify({ secret }));
}
export function adminTotpSecret(): string {
  return JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).secret;
}
/** A currently valid code (waits for the next 30-second window if the current one was already used for this account this step). */
export const adminCode = () => totpAt(adminTotpSecret(), Date.now());

/** Password login, then the TOTP step — a fresh admin context in one call. */
export async function loginAdmin(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  // a database nobody has enrolled an admin on yet (e.g. only the mobile project is run): do the first-login set-up
  if (!fs.existsSync(SECRET_FILE)) return enrolAdminFresh(browser);
  const { ctx, page } = await newUserContext(browser);
  await page.goto('/login');
  await page.getByLabel('Email or phone number').fill(ADMIN_EMAIL);
  await page.locator('input[type=password]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/auth\/2fa/);
  await page.getByTestId('totp-code').fill(adminCode());
  await page.getByTestId('verify-2fa').click();
  await page.waitForURL(/\/admin/);
  return { ctx, page };
}

/** First-ever admin login on a fresh database (one-time password → new password → two-factor enrolment); leaves the context signed in with 2FA done and saves the TOTP secret. */
/** A signed-in admin context: enrols a fresh database's admin, or logs in when the desktop run already did. */
export async function adminSession(browser: Browser, viewport?: { width: number; height: number }): Promise<{ ctx: BrowserContext; page: Page }> {
  if (fs.existsSync(SECRET_FILE)) {
    const s = await loginAdmin(browser);
    if (viewport) await s.page.setViewportSize(viewport);
    return s;
  }
  return enrolAdminFresh(browser, viewport);
}

export async function enrolAdminFresh(browser: Browser, viewport?: { width: number; height: number }): Promise<{ ctx: BrowserContext; page: Page }> {
  const { ctx, page } = await newUserContext(browser, { viewport });
  await page.goto('/login');
  await page.getByLabel('Email or phone number').fill(ADMIN_EMAIL);
  await page.locator('input[type=password]').fill(ADMIN_FIRST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/change-password/);
  await page.locator('input[type=password]').nth(0).fill(ADMIN_FIRST_PASSWORD);
  await page.locator('input[type=password]').nth(1).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();
  await page.waitForURL(/\/(admin|auth\/2fa)/);
  await page.goto('/admin');
  await page.waitForURL(/\/auth\/2fa/);
  await page.getByTestId('start-2fa').click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByTestId('totp-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('enable-2fa').click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  saveAdminTotp(secret);
  await page.getByTestId('recovery-saved').click();
  await page.waitForURL(/\/admin/);
  return { ctx, page };
}

export async function seedKitchen(request: APIRequestContext, b: { n: number; societyId?: number; fssai?: 'verified' | 'provisional'; price?: number; qty?: number; cash?: boolean }) {
  const r = await api(request, 'post', '/api/dev/seed-kitchen', b);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as { sellerId: number; email: string; dishId: number; kitchenName: string };
}

export async function orderAction(request: APIRequestContext, orderId: number, action: string, extra: Record<string, unknown> = {}) {
  const r = await api(request, 'post', `/api/orders/${orderId}/action`, { action, ...extra });
  expect(r.status, `${action}: ${JSON.stringify(r.json)}`).toBe(200);
  return r.json;
}

export async function timeTravelOrder(request: APIRequestContext, kind: 'order_accept_deadline' | 'order_age' | 'order_completed_ago' | 'grievance_age', orderId: number, minutes = 0) {
  const r = await api(request, 'post', '/api/dev/time-travel', { kind, orderId, minutes, sellerId: 0, days: 0 });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}
