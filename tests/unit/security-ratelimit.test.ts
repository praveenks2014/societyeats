import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useTestDb } from '../helpers/db';

vi.mock('next/headers', () => import('../helpers/next-headers'));

beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  await useTestDb();
});

/** G5: the unauthenticated, abuse-prone endpoints stop answering after their configured burst, and the response says 429 (not a silent drop). */
const CASES: { path: string; limit: number }[] = [
  { path: 'auth/login', limit: 10 },
  { path: 'auth/register', limit: 5 },
  { path: 'auth/forgot-password', limit: 5 },
  { path: 'auth/reset-password', limit: 10 },
  { path: 'auth/login-code/request', limit: 10 },
  { path: 'auth/login-code/verify', limit: 20 },
  { path: 'auth/verify-email', limit: 20 },
  { path: 'access-requests', limit: 5 },
];

let seq = 0;
describe('G5: rate limits', () => {
  for (const [i, c] of CASES.entries()) {
    test(`${c.path}: request ${c.limit + 1} from one IP is 429, another IP is unaffected`, async () => {
      const mod = (await import(`@/app/api/${c.path}/route`)) as { POST: (r: NextRequest, ctx: unknown) => Promise<Response> };
      const req = (ip: string) => new NextRequest(`http://localhost:3000/api/${c.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email: `rl${i}-${seq++}@x.example`, code: '1234' }) });
      const ip = `10.20.${i}.1`;
      for (let n = 0; n < c.limit; n++) expect((await mod.POST(req(ip), { params: {} })).status, `${c.path} #${n + 1}`).not.toBe(429);
      const blocked = await mod.POST(req(ip), { params: {} });
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toHaveProperty('error');
      expect((await mod.POST(req(`10.30.${i}.1`), { params: {} })).status).not.toBe(429);
    });
  }
});
