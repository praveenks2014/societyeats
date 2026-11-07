import { NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { buildExport, EXPORT_KINDS, parseRange, type ExportKind } from '@/lib/exports';

export const dynamic = 'force-dynamic';

/** CSV exports (?from=YYYY-MM-DD&to=YYYY-MM-DD). Each needs a fresh 2FA check and is audit-logged with its range. */
export const GET = api<{ params: { kind: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  if (!(EXPORT_KINDS as readonly string[]).includes(params.kind)) throw new ApiError(404, 'Unknown export');
  const kind = params.kind as ExportKind;
  const range = parseRange(req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'));
  const csv = await buildExport(kind, range);
  await recordAudit({ actorId: admin.uid, action: `export.${kind}`, targetType: 'export', meta: { from: range.from.toISOString(), to: range.to.toISOString(), rows: csv.split('\n').length - 2 } });
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="padosiplate-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
});
