import { NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { fyStartYear, tdsReport } from '@/lib/orders/earnings';

export const dynamic = 'force-dynamic';

/** TDS (Income-tax Act 2025 s.393) export. PAN is masked unless `?fullPan=1`; both need a fresh 2FA check and are audit-logged. */
export const GET = api(async (req) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const raw = req.nextUrl.searchParams.get('fy');
  const year = raw ? Number(raw) : fyStartYear();
  if (!Number.isInteger(year) || year < 2024 || year > fyStartYear() + 1) throw new ApiError(400, 'Unknown financial year');
  const fullPan = req.nextUrl.searchParams.get('fullPan') === '1';
  const csv = await tdsReport(year, fullPan);
  await recordAudit({ actorId: admin.uid, action: fullPan ? 'export.tds.full_pan' : 'export.tds', targetType: 'export', meta: { fy: year } });
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tds-FY${year}.csv"`, 'Cache-Control': 'no-store' } });
});
