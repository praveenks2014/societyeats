import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import zlib from 'node:zlib';

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

export async function newUserContext(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3100' });
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
  const r = await api(request, 'post', '/api/auth/register', { password: 'Sturdy-pass-42', inviteCode: u.code ?? 'E2E-ONE', role: u.role ?? 'buyer', ...u });
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
