import { desc, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { payouts, sellerProfiles, users } from '@/lib/db/schema';
import { generatePayoutBatch } from '@/lib/payouts';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db
    .select({ payout: payouts, seller: users, profile: sellerProfiles })
    .from(payouts)
    .innerJoin(users, eq(payouts.sellerId, users.id))
    .leftJoin(sellerProfiles, eq(payouts.sellerId, sellerProfiles.userId))
    .orderBy(desc(payouts.createdAt));

  const list = rows.map((r) => ({
    ...r.payout,
    sellerName: r.seller.name,
    kitchenName: r.profile?.kitchenName ?? r.seller.name,
  }));

  const pending = list.filter((p) => p.status === 'pending');
  return ok({
    payouts: list,
    summary: {
      pendingCount: pending.length,
      pendingPayableInPaise: pending.reduce((s, p) => s + p.netPayableInPaise, 0),
    },
  });
});

export const POST = api(async () => {
  await requireSession(['admin']);
  const result = await generatePayoutBatch();
  return ok(result);
});
