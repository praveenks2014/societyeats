import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { geocode } from '@/lib/geocode';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  await requireSession(['admin']);
  const { address, pincode } = await readJson<{ address: string; pincode?: string }>(req);
  const r = await geocode(address ?? '', pincode);
  if (!r) throw new ApiError(404, 'Could not find that address — enter latitude/longitude manually');
  return ok(r);
});
