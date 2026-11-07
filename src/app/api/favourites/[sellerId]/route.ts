import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { isFavourite, setFavourite } from '@/lib/favourites';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { sellerId: string } }>(async (_req, { params }) => {
  const session = await requireSession(['buyer', 'seller']);
  return ok(await isFavourite(session.uid, Number(params.sellerId)));
});

/** Follow a kitchen (optionally without “cooking” alerts), or change that choice. */
export const PUT = api<{ params: { sellerId: string } }>(async (req, { params }) => {
  const session = await requireSession(['buyer', 'seller']);
  await rateLimit(`fav:${session.uid}`, { limit: 60, windowMs: 60 * 60 * 1000 });
  const parsed = z.object({ notifyCooking: z.boolean().default(true) }).safeParse(await readJson(req).catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  return ok(await setFavourite(session.uid, Number(params.sellerId), true, parsed.data.notifyCooking));
});

export const DELETE = api<{ params: { sellerId: string } }>(async (_req, { params }) => {
  const session = await requireSession(['buyer', 'seller']);
  return ok(await setFavourite(session.uid, Number(params.sellerId), false));
});
