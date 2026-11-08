import { NextResponse } from 'next/server';
import { api } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { exportUserData } from '@/lib/account';
import { recordAudit } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { BRAND } from '@/config/brand';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(undefined, { allowMustChange: true });
  await rateLimit(`export:${session.uid}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  const data = await exportUserData(session.uid);
  await recordAudit({ actorId: session.uid, action: 'account.export', targetType: 'user', targetId: session.uid });
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="my-${BRAND.slug}-data.json"` } });
});
