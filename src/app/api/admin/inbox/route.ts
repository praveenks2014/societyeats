import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { adminUnreadCount, listThreads } from '@/lib/messaging/admin-threads';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession(['admin']);
  const sp = req.nextUrl.searchParams;
  const sellerId = Number(sp.get('sellerId')) || undefined;
  const societyId = Number(sp.get('societyId')) || undefined;
  let threads = await listThreads({ sellerId, societyId, unreadFor: 'admin' });
  if (sp.get('unread') === '1') threads = threads.filter((t) => t.unread > 0);
  return ok({ threads, unread: await adminUnreadCount() });
});
