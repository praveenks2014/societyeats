import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { fyStartYear, sellerEarnings } from '@/lib/orders/earnings';

export const dynamic = 'force-dynamic';

/** A kitchen's own sales record by financial year and month. Food money is paid to the kitchen directly — there is no settlement here. */
export const GET = api(async (req) => {
  const session = await requireSession(['seller']);
  const raw = req.nextUrl.searchParams.get('fy');
  const year = raw ? Number(raw) : fyStartYear();
  if (!Number.isInteger(year) || year < 2024 || year > fyStartYear() + 1) throw new ApiError(400, 'Unknown financial year');
  return ok({ ...(await sellerEarnings(session.uid, year)), currentFyStartYear: fyStartYear() });
});
