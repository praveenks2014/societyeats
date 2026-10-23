import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { listThreads, sellerUnreadCount } from '@/lib/messaging/admin-threads';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  return ok({ threads: await listThreads({ sellerId: session.uid, unreadFor: 'seller' }), unread: await sellerUnreadCount(session.uid) });
});
