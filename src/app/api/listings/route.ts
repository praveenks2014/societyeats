import { api, ok } from '@/lib/api';
import { browseListings } from '@/lib/browse';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const sp = req.nextUrl.searchParams;
  const lat = sp.get('lat');
  const lng = sp.get('lng');
  const result = await browseListings({
    lat: lat ? Number(lat) : undefined,
    lng: lng ? Number(lng) : undefined,
    veg: sp.get('veg') === '1',
    cuisine: sp.get('cuisine') || undefined,
    q: sp.get('q') || undefined,
  });
  return ok(result);
});
