import { NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { earningsCsv, fyStartYear } from '@/lib/orders/earnings';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const session = await requireSession(['seller']);
  const raw = req.nextUrl.searchParams.get('fy');
  const year = raw ? Number(raw) : fyStartYear();
  if (!Number.isInteger(year) || year < 2024 || year > fyStartYear() + 1) throw new ApiError(400, 'Unknown financial year');
  return new NextResponse(await earningsCsv(session.uid, year), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-FY${year}-${String((year + 1) % 100).padStart(2, '0')}.csv"`, 'Cache-Control': 'no-store' } });
});
