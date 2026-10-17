import { NextResponse } from 'next/server';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { revenueCsv, revenueReport, type RevenueRange } from '@/lib/revenue';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession(['admin']);
  const sp = req.nextUrl.searchParams;
  const range = (['today', '7d', '30d'].includes(sp.get('range') ?? '') ? sp.get('range') : '7d') as RevenueRange;
  const report = await revenueReport(range);
  if (sp.get('format') === 'csv') {
    return new NextResponse(revenueCsv(report), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="padosiplate-revenue-${range}.csv"` },
    });
  }
  return ok(report);
});
