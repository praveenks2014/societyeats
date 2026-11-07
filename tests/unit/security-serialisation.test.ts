import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { call, jsonReq, loginAs } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret_value';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

/** Secrets and hashes must never appear in any API response, at any depth, for any role. */
const FORBIDDEN = /passwordhash|totpsecret|secretenc|otphash|pwhash|recoverycodes|jwt|apikey|webhooksecret|razorpay_key_secret/i;
function leaks(value: unknown, trail = ''): string[] {
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaks(v, `${trail}[${i}]`));
  return Object.entries(value).flatMap(([k, v]) => (FORBIDDEN.test(k) ? [`${trail}.${k}`] : leaks(v, `${trail}.${k}`)));
}
const keys = (o: Record<string, unknown>) => Object.keys(o).sort();

describe('G2: what each role sees of an order, by state', () => {
  test('field sets per role and state are pinned, and no secret key ever appears', async () => {
    const { createHomeOrder } = await import('@/lib/orders/create');
    const { markOrderPaid } = await import('@/lib/payments');
    const { GET } = await import('@/app/api/orders/[id]/route');
    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const buyer = await makeUser(db, 'buyer', { societyId, phone: '9000000077' });
    const admin = await makeUser(db, 'admin', { societyId });
    process.env.ADMIN_EMAILS = admin.email!;
    const r = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 1 }], fulfillmentType: 'self_pickup' });
    const p = { id: String(r.orderId) };
    const view = async (uid: number) => {
      await loginAs(uid);
      const res = await call(GET, jsonReq('/x', undefined, { method: 'GET' }), p);
      return res;
    };
    const seen: Record<string, string[]> = {};
    for (const phase of ['fee_pending', 'booked']) {
      if (phase === 'booked') await markOrderPaid(r.orderId, { razorpayPaymentId: 'pay_ser' });
      for (const [role, uid] of [['buyer', buyer.id], ['seller', k.seller.id], ['admin', admin.id]] as const) {
        const { status, json } = await view(uid);
        expect(status, `${role}/${phase} ${JSON.stringify(json)}`).toBe(200);
        expect(leaks(json), `${role}/${phase}`).toEqual([]);
        seen[`${role}/${phase}`] = keys(json);
        // nobody gets the other party's password hash or the buyer's phone before it is shared
        if (role === 'seller') expect(JSON.stringify(json)).not.toContain('9000000077');
      }
    }
    expect(seen).toMatchSnapshot();
  });

  test('public and account endpoints carry no secrets', async () => {
    const u = await makeUser(db, 'buyer', { societyId });
    await loginAs(u.id);
    for (const path of ['auth/me', 'fee-config', 'disclaimers', 'societies']) {
      const mod = (await import(`@/app/api/${path}/route`)) as { GET: (r: Request, c: unknown) => Promise<Response> };
      const res = await mod.GET(jsonReq(`/api/${path}`, undefined, { method: 'GET' }), { params: {} });
      expect(leaks(await res.json()), path).toEqual([]);
    }
  });
});
