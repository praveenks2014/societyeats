import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { unreadCounts } from '@/lib/messaging/order-thread';

export const dynamic = 'force-dynamic';

/** Unread chat messages for the signed-in user: total (header badge) and per order. */
export const GET = api(async () => {
  const session = await requireSession(['buyer', 'seller']);
  return ok(await unreadCounts(session.uid));
});
