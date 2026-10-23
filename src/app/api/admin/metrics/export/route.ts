import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getWeeklyMetrics, toWeeklyMetricsCsv } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * CSV of the weekly metrics table for one society (`?societyId=`). Not
 * wrapped in the JSON api() helper since a successful response here is CSV,
 * not JSON — same pattern as /api/admin/payouts/export.
 */
export async function GET(req: Request) {
  try {
    await requireSession(['admin']);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const societyId = Number(new URL(req.url).searchParams.get('societyId'));
  if (!Number.isInteger(societyId)) {
    return NextResponse.json({ error: 'societyId is required' }, { status: 400 });
  }
  const db = await getDb();
  const [society] = await db.select().from(societies).where(eq(societies.id, societyId));
  if (!society) return NextResponse.json({ error: 'Society not found' }, { status: 404 });

  const data = await getWeeklyMetrics(societyId);
  if (!data) return NextResponse.json({ error: 'Society not found' }, { status: 404 });
  const csv = toWeeklyMetricsCsv(society.name, data);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="padosiplate-pilot-metrics-${society.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
