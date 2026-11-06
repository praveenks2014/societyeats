import { beforeAll, describe, expect, test, vi } from 'vitest';
import { call, jsonReq, loginAs } from '../helpers/http';
import { makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let admin: Awaited<ReturnType<typeof makeUser>>;
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  db = await useTestDb();
  admin = await makeUser(db, 'admin');
  process.env.ADMIN_EMAILS = admin.email!;
  const { seedSubscriptionPlans } = await import('@/lib/subscriptions/plans');
  await seedSubscriptionPlans(db);
});

describe('plan catalogue (A6)', () => {
  test('seed: Monthly 199, Quarterly 499, Yearly 1799 on sale; Founding free and inactive; seeding twice changes nothing', async () => {
    const { seedSubscriptionPlans } = await import('@/lib/subscriptions/plans');
    await seedSubscriptionPlans(db);
    const plans = await db.select().from(s.subscriptionPlans);
    const by = Object.fromEntries(plans.map((p) => [p.name, p]));
    expect([by.Monthly.pricePaise, by.Quarterly.pricePaise, by.Yearly.pricePaise]).toEqual([19900, 49900, 179900]);
    expect(by['Founding kitchen']).toMatchObject({ pricePaise: 0, active: false });
    expect(plans.filter((p) => p.name === 'Monthly')).toHaveLength(1);
  });

  test('admin can create, edit and archive plans; every change needs a fresh 2FA check and is audited', async () => {
    const { POST } = await import('@/app/api/admin/subscriptions/route');
    await loginAs(admin.id, { mfa: false });
    const denied = await call(POST, jsonReq('/x', { action: 'plan_save', name: 'Half-yearly', durationMonths: 6, pricePaise: 99900, active: true }));
    expect(denied.status).toBeGreaterThanOrEqual(400);

    await loginAs(admin.id);
    const created = await call(POST, jsonReq('/x', { action: 'plan_save', name: 'Half-yearly', durationMonths: 6, pricePaise: 99900, active: true }));
    expect(created.status).toBe(200);
    const id = (created.json.plan as { id: number }).id;
    const archived = await call(POST, jsonReq('/x', { action: 'plan_save', id, name: 'Half-yearly', durationMonths: 6, pricePaise: 99900, active: false }));
    expect((archived.json.plan as { active: boolean }).active).toBe(false);
    const { getActivePlans } = await import('@/lib/subscriptions/plans');
    expect((await getActivePlans(db)).some((p) => p.id === id)).toBe(false);
    expect((await db.select().from(s.auditLog)).filter((a) => a.action === 'plan.save').length).toBeGreaterThanOrEqual(2);
  });

  test('a purchasable plan cannot be free; the Founding plan stays archived at ₹0', async () => {
    const { POST } = await import('@/app/api/admin/subscriptions/route');
    await loginAs(admin.id);
    const free = await call(POST, jsonReq('/x', { action: 'plan_save', name: 'Freebie', durationMonths: 1, pricePaise: 0, active: true }));
    expect(free.status).toBe(400);
    const founding = (await db.select().from(s.subscriptionPlans)).find((p) => p.name === 'Founding kitchen')!;
    const ok = await call(POST, jsonReq('/x', { action: 'plan_save', id: founding.id, name: 'Founding kitchen', durationMonths: 3, pricePaise: 0, active: false }));
    expect(ok.status).toBe(200);
  });
});
