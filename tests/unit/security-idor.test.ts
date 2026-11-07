import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { loginAs } from '../helpers/http';
import { resetRequestContext } from '../helpers/next-headers';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

/** G1: every API route, walked from the file tree, so a new route cannot ship without a decision. */
const API = path.join(__dirname, '../../src/app/api');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : []));
}
const routes = walk(API).map((f) => ({ file: f, url: '/api' + path.dirname(f).slice(API.length).replace(/\[(\w+)\]/g, ':$1') || '/api' }));

/** Routes that are public by design (credential flows, health, public read data, secret-authenticated hooks). */
const PUBLIC = [
  'auth/forgot-password', 'auth/google/callback', 'auth/login-code/request', 'auth/login-code/verify', 'auth/login', 'auth/logout', 'auth/register', 'auth/reset-password', 'auth/verify-email',
  'csp-report', 'access-requests', 'auth/google/start', 'auth/me', 'quote', 'files/:key', 'dev/outbox', 'dev/seed-kitchen', 'dev/time-travel', 'disclaimers', 'fee-config', 'fssai/badge/:sellerId', 'health', 'push/config', 'societies', 'visit',
];
const SECRET_AUTH = ['webhooks/razorpay', 'cron/run'];
const rel = (u: string) => u.replace(/^\/api\//, '');

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

describe('G1: route inventory', () => {
  test('every route either requires a session, is on the public list, or authenticates by secret', () => {
    const open = routes.filter((r) => !/requireSession|requireRecentMfa|getSession|requireUser|requireAdmin/.test(fs.readFileSync(r.file, 'utf8'))).map((r) => rel(r.url));
    const unexplained = open.filter((u) => !PUBLIC.includes(u) && !SECRET_AUTH.some((x) => u.startsWith(x)));
    expect(unexplained).toEqual([]);
  });
  test('dev endpoints refuse to run outside E2E', async () => {
    delete process.env.E2E;
    for (const p of ['dev/time-travel', 'dev/seed-kitchen', 'dev/outbox']) {
      const mod = await import(`@/app/api/${p}/route`);
      const h = (mod.POST ?? mod.GET) as (r: NextRequest) => Promise<Response>;
      const res = await h(new NextRequest(`http://localhost:3000/api/${p}`, { method: mod.POST ? 'POST' : 'GET', body: mod.POST ? '{}' : undefined }));
      expect([401, 403, 404]).toContain(res.status);
    }
  });
});

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
async function hit(file: string, urlTemplate: string) {
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
  const out: { method: string; status: number }[] = [];
  for (const m of METHODS) {
    const h = mod[m] as ((req: NextRequest, ctx: unknown) => Promise<Response>) | undefined;
    if (!h) continue;
    const url = 'http://localhost:3000' + urlTemplate.replace(/:\w+/g, '1');
    const params = Object.fromEntries([...urlTemplate.matchAll(/:(\w+)/g)].map((x) => [x[1], '1']));
    const req = new NextRequest(url, { method: m, headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' }, body: m === 'GET' ? undefined : '{}' });
    const res = await h(req, { params });
    out.push({ method: m, status: res.status });
  }
  return out;
}

describe('G1: anonymous callers', () => {
  test('no protected route answers an anonymous caller with anything but 401/403', async () => {
    resetRequestContext();
    const bad: string[] = [];
    for (const r of routes) {
      const u = rel(r.url);
      if (PUBLIC.includes(u) || SECRET_AUTH.some((x) => u.startsWith(x))) continue;
      for (const { method, status } of await hit(r.file, r.url)) if (![401, 403].includes(status) && !(u.startsWith('restaurant/') && status === 404)) bad.push(`${method} ${r.url} → ${status}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});

describe('G1: wrong role', () => {
  test('a buyer is refused on every admin and seller route; a seller on every admin route', async () => {
    const buyer = await makeUser(db, 'buyer', { societyId });
    const seller = (await makeLiveKitchen(db, { societyId })).seller;
    const bad: string[] = [];
    for (const [user, prefix] of [[buyer, 'admin/'], [buyer, 'seller/'], [seller, 'admin/']] as const) {
      await loginAs(user.id);
      for (const r of routes.filter((x) => rel(x.url).startsWith(prefix))) {
        for (const { method, status } of await hit(r.file, r.url)) if (status !== 403) bad.push(`${user.role} ${method} ${r.url} → ${status}`);
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});

describe('G1: other people’s objects', () => {
  test('a stranger gets 403/404 for someone else’s order, invoice, chat and actions', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where((await import('drizzle-orm')).eq(s.sellerProfiles.userId, k.seller.id));
    const owner = await makeUser(db, 'buyer', { societyId });
    const stranger = await makeUser(db, 'buyer', { societyId });
    const otherSeller = (await makeLiveKitchen(db, { societyId })).seller;
    const o = await createHomeOrder({ buyerId: owner.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    const id = String(o.orderId);
    const targets = [
      ['orders/:id', 'GET'], ['orders/:id/invoice', 'GET'], ['orders/:id/messages', 'GET'], ['orders/:id/messages', 'POST'], ['orders/:id/action', 'POST'], ['orders/:id/repeat', 'POST'], ['orders/:id/review', 'POST'], ['orders/:id/complaint', 'POST'], ['orders/:id/verify-otp', 'POST'],
    ] as const;
    for (const user of [stranger, otherSeller]) {
      await loginAs(user.id);
      for (const [tpl, method] of targets) {
        const mod = (await import(`@/app/api/${tpl.replace(':id', '[id]')}/route`)) as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>;
        if (!mod[method]) continue;
        const res = await mod[method](new NextRequest(`http://localhost:3000/api/${tpl.replace(':id', id)}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.8' }, body: method === 'GET' ? undefined : JSON.stringify(tpl.endsWith('messages') ? { action: 'send', body: 'hi' } : { action: 'accept', reason: 'x', rating: 5, text: 'x', kind: 'other', note: 'x', otp: '1234', body: 'hi', category: 'quality', description: 'cold food' }) }), { params: { id } });
        expect([401, 403, 404], `${user.role} ${method} ${tpl} → ${res.status}`).toContain(res.status);
      }
    }
  });
});
