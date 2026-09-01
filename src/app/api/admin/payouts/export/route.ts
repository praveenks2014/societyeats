import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { payouts, sellerProfiles, users } from '@/lib/db/schema';
import { toPayoutCsv } from '@/lib/payouts';

export const dynamic = 'force-dynamic';

/**
 * CSV of every currently-pending payout for the admin to action manually
 * (name, VPA/bank, amount). Not wrapped in the JSON api() helper since a
 * successful response here is CSV, not JSON — errors are handled by hand.
 */
export async function GET() {
  try {
    await requireSession(['admin']);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const db = await getDb();
  const rows = await db
    .select({ payout: payouts, seller: users, profile: sellerProfiles })
    .from(payouts)
    .innerJoin(users, eq(payouts.sellerId, users.id))
    .leftJoin(sellerProfiles, eq(payouts.sellerId, sellerProfiles.userId))
    .where(eq(payouts.status, 'pending'));

  const csv = toPayoutCsv(
    rows.map((r) => ({
      id: r.payout.id,
      sellerName: r.profile?.kitchenName ?? r.seller.name,
      destination: r.payout.payoutDestinationSnapshot ?? r.profile?.payoutVpaOrBank ?? '',
      amountInPaise: r.payout.netPayableInPaise,
      orderCount: r.payout.orderCount,
    })),
  );

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gharse-payouts-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
