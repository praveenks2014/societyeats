import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { listFavourites } from '@/lib/favourites';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['buyer', 'seller']);
  return ok({ favourites: await listFavourites(session.uid) });
});
